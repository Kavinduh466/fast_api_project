import os
import cv2
import faiss
import numpy as np

from server.config import FAISS_INDEX_PATH, IMAGE_PATHS_FILE, UPLOAD_DIR
from server.services.detector import detect_components
from server.services.vectorizer import vectorize_crop


# ---------------------------------------------------------------------------
# Annotation helpers — backend only draws bbox rectangles now.
# Numbered badges are rendered as an interactive overlay on the frontend so
# they can be clicked, hover-highlighted, and never collide regardless of
# how dense the scene is.
# ---------------------------------------------------------------------------

# --- INTERNAL STATE (Lazy Loaded) ---
_models = {
    "index": None,
    "image_paths": None
}

def _get_models():
    """Lazy loader for FAISS index and image paths."""
    if _models["index"] is None:
        if not os.path.exists(FAISS_INDEX_PATH):
            print(f"WARNING: FAISS index not found at {FAISS_INDEX_PATH}. Similarity audit will be disabled.")
            return None, None
            
        _models["index"] = faiss.read_index(str(FAISS_INDEX_PATH))

    if _models["image_paths"] is None:
        if not os.path.exists(IMAGE_PATHS_FILE):
            print(f"WARNING: Image paths file not found at {IMAGE_PATHS_FILE}.")
            _models["image_paths"] = []
        else:
            with open(str(IMAGE_PATHS_FILE), "r") as f:
                _models["image_paths"] = [line.strip() for line in f.readlines()]
    
    return _models["index"], _models["image_paths"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _path_matches_category(path: str, category: str) -> bool:
    """
    Return True if `path` belongs to Expert_Library/<category>/... .
    Matching is case-insensitive and tolerates both underscore-style folder
    names (`Health__Fitness`) and human-readable labels (`Health & Fitness`).
    """
    if not path or not category:
        return False
    # Normalise both sides: lowercase, collapse separators and whitespace.
    def norm(s: str) -> str:
        return (
            s.lower()
             .replace("&", "and")
             .replace("-", "")
             .replace("_", "")
             .replace(" ", "")
        )
    wanted = norm(category)
    # `path` looks like "Expert_Library/Medical/Mobile/Link/m_0_0.jpg"
    parts = path.replace("\\", "/").split("/")
    if len(parts) < 2:
        return False
    folder = parts[1] if parts[0].lower().startswith("expert") else parts[0]
    return norm(folder) == wanted


def run_audit(image_path: str, category: str | None = None) -> dict:
    """
    Full audit pipeline:
      1. Detect UI components with YOLOv8  (via detector service)
      2. Vectorize each crop with CLIP     (via vectorizer service)
      3. Search FAISS for the nearest expert match
         — if `category` is given, restrict matches to expert crops in that
           folder of Expert_Library (e.g. "Medical", "Finance"). When a
           category has no plausible match in the top-K candidates, we fall
           back to the overall nearest neighbour so the score never goes
           blank.
      4. Return scores and generate an annotated report image

    Returns a dict suitable for JSON serialisation.
    """
    img = cv2.imread(image_path)
    if img is None:
        return {"error": "Could not read image"}

    # --- Step 1: Detect components ---
    result = detect_components(image_path)
    boxes = result.boxes

    if len(boxes) == 0:
        return {"error": "No UI components detected", "components": []}

    components = []

    # Upscale small images so numbered badges stay crisp on high-DPI frontends.
    orig_h, orig_w = img.shape[:2]
    target_long_edge = 1600
    long_edge = max(orig_w, orig_h)
    scale = target_long_edge / long_edge if long_edge < target_long_edge else 1.0
    if scale > 1.0:
        annotated = cv2.resize(
            img,
            (int(orig_w * scale), int(orig_h * scale)),
            interpolation=cv2.INTER_CUBIC,
        )
    else:
        annotated = img.copy()

    ann_long = max(annotated.shape[0], annotated.shape[1])
    box_thickness = 3 if ann_long >= 1200 else 2

    for idx, box in enumerate(boxes, start=1):
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        cls_id = int(box.cls[0])
        cls_name = result.names[cls_id]
        conf = float(box.conf[0])

        # Crop the detected element
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        # --- Step 2: Vectorize ---
        vector = vectorize_crop(crop)

        # --- Step 3: Search FAISS ---
        index, image_paths = _get_models()

        if index is not None:
            # When a category is specified we search a larger neighbourhood
            # and keep the nearest hit that belongs to that category. 100 is
            # plenty — the smallest category in the library still has far
            # more than 100 samples, so we almost always find an in-category
            # match. If we don't, we gracefully fall back to k=1 behaviour.
            k = 100 if category else 1
            distances, indices = index.search(vector, k=k)

            chosen_dist = float(distances[0][0])
            chosen_idx = int(indices[0][0])
            chosen_path = (
                image_paths[chosen_idx]
                if chosen_idx < len(image_paths) else "unknown"
            )

            if category:
                for rank in range(k):
                    cand_idx = int(indices[0][rank])
                    if cand_idx < 0 or cand_idx >= len(image_paths):
                        continue
                    cand_path = image_paths[cand_idx]
                    if _path_matches_category(cand_path, category):
                        chosen_dist = float(distances[0][rank])
                        chosen_idx = cand_idx
                        chosen_path = cand_path
                        break

            similarity = float(1 / (1 + chosen_dist))  # distance → similarity
            similarity_pct = round(similarity * 100, 1)
            matched_path = chosen_path
        else:
            similarity_pct = 0.0
            matched_path = "N/A"

        components.append(
            {
                "id": idx,
                "class": cls_name,
                "confidence": round(conf, 3),
                "bbox": [x1, y1, x2, y2],
                "similarity_score": similarity_pct,
                "matched_expert": os.path.basename(matched_path),
            }
        )

        # Annotate image with colour-coded bounding boxes
        if similarity_pct >= 70:
            color = (0, 255, 0)       # green  – good
        elif similarity_pct >= 50:
            color = (0, 165, 255)     # orange – okay
        else:
            color = (0, 0, 255)       # red    – needs work

        # Scale bbox coordinates to annotated-image space if we upscaled
        sx1 = int(x1 * scale); sy1 = int(y1 * scale)
        sx2 = int(x2 * scale); sy2 = int(y2 * scale)

        cv2.rectangle(annotated, (sx1, sy1), (sx2, sy2), color,
                      box_thickness, cv2.LINE_AA)

    # --- Overall score & grade ---
    avg_score = round(
        float(np.mean([c["similarity_score"] for c in components])), 1
    )
    if avg_score >= 80:
        grade = "EXCELLENT"
    elif avg_score >= 60:
        grade = "GOOD"
    else:
        grade = "NEEDS WORK"

    # Save annotated report image as PNG for sharp text; also keep a .jpg
    # shadow for back-compat with any older URL patterns.
    report_id = os.path.splitext(os.path.basename(image_path))[0]
    report_path_png = os.path.join(str(UPLOAD_DIR), f"{report_id}_report.png")
    report_path_jpg = os.path.join(str(UPLOAD_DIR), f"{report_id}_report.jpg")
    cv2.imwrite(report_path_png, annotated,
                [cv2.IMWRITE_PNG_COMPRESSION, 3])
    cv2.imwrite(report_path_jpg, annotated,
                [cv2.IMWRITE_JPEG_QUALITY, 95])

    return {
        "report_id": report_id,
        "overall_score": avg_score,
        "grade": grade,
        "total_components": len(components),
        "components": components,
        "report_image_url": f"/audit/report/{report_id}",
        # Original image size — bboxes in `components` use these coords.
        # Frontend uses this to position the interactive badge overlay.
        "image_size": {"width": int(orig_w), "height": int(orig_h)},
        # Expert-library category used to score against ("universal" = all).
        "category": category or "universal",
    }

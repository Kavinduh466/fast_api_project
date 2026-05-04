import cv2
import numpy as np
import easyocr
from sklearn.cluster import KMeans

# --- INTERNAL STATE (Lazy Loaded) ---
_reader = None

def _get_reader():
    """Lazy loader for easyocr Reader."""
    global _reader
    if _reader is None:
        print("📥 Initializing EasyOCR Reader (English)...")
        _reader = easyocr.Reader(['en'], gpu=False)
    return _reader

def get_contrast_ratio(color1, color2):
    """
    Calculates Contrast Ratio using official WCAG 2.1 Formula.
    Input: RGB Tuples (r, g, b)
    Returns: Float (e.g., 4.5)
    """
    def luminance(color):
        # W3C Formula for Relative Luminance
        rgb = [c / 255.0 for c in color]
        rgb = [(c / 12.92) if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]

    lum1 = luminance(color1)
    lum2 = luminance(color2)
    
    bright = max(lum1, lum2)
    dark = min(lum1, lum2)
    
    return (bright + 0.05) / (dark + 0.05)

def analyze_element_content(img_crop):
    """
    1. Reads Text (OCR).
    2. Extracts Dominant Colors (Background & Text).
    3. Calculates Contrast.
    """
    # A. READ TEXT
    # EasyOCR expects RGB, OpenCV gives BGR
    img_rgb = cv2.cvtColor(img_crop, cv2.COLOR_BGR2RGB)
    reader = _get_reader()
    results = reader.readtext(img_rgb, detail=0) 
    text_content = " ".join(results).strip()
    
    if not text_content:
        return {"text": "Icon/Graphic", "contrast": None, "bg_color": None}

    # B. EXTRACT COLORS (K-Means Clustering)
    # Reshape image to list of pixels
    pixels = img_rgb.reshape(-1, 3)
    
    # We ask K-Means to find the 2 most common colors (likely BG and Text)
    kmeans = KMeans(n_clusters=2, n_init=5)
    kmeans.fit(pixels)
    colors = kmeans.cluster_centers_
    
    # Determine which is BG (the most frequent one)
    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    bg_idx = np.argmax(counts)
    fg_idx = 1 - bg_idx # The other one is foreground
    
    bg_color = colors[bg_idx]
    fg_color = colors[fg_idx]
    
    # C. CALCULATE CONTRAST
    ratio = get_contrast_ratio(bg_color, fg_color)
    
    return {
        "text": text_content,
        "contrast": round(ratio, 2),
        "bg_color": [int(c) for c in bg_color], # Convert to int for easy reading
        "fg_color": [int(c) for c in fg_color]
    }


def compute_layout_metrics(elements: list, img_w: int, img_h: int) -> dict:
    """
    Coarse layout stats for LLM context (alignment / whitespace / density).
    Values are in [0, 1] where higher alignment_score means more consistent vertical rhythm.
    """
    if not elements or img_w <= 0 or img_h <= 0:
        return {
            "alignment_score": 1.0,
            "whitespace_ratio": 1.0,
            "density": 0.0,
        }

    total_area = float(img_w * img_h)
    covered = 0.0
    centers_y: list[float] = []

    for el in elements:
        bbox = el.get("bbox") or [0, 0, 0, 0]
        x1, y1, x2, y2 = bbox
        w = max(0, int(x2) - int(x1))
        h = max(0, int(y2) - int(y1))
        covered += float(w * h)
        centers_y.append((float(y1) + float(y2)) / 2.0)

    density = min(1.0, covered / total_area)
    whitespace_ratio = max(0.0, min(1.0, 1.0 - density))

    if len(centers_y) > 1:
        std_y = float(np.std(np.array(centers_y, dtype=np.float64)))
        alignment_score = max(0.0, min(1.0, 1.0 - std_y / max(float(img_h), 1.0)))
    else:
        alignment_score = 1.0

    return {
        "alignment_score": round(alignment_score, 3),
        "whitespace_ratio": round(whitespace_ratio, 3),
        "density": round(density, 3),
    }


def build_elements_summary(elements: list, max_items: int = 12) -> str:
    """Compact text block of detected elements for LLM prompts."""
    if not elements:
        return "DETECTED ELEMENTS:\n  (none)"

    lines: list[str] = []
    for el in elements[:max_items]:
        content = el.get("content") or {}
        text = str(content.get("text", ""))[:48]
        contrast = content.get("contrast")
        lines.append(
            f"  - id={el.get('id')} type={el.get('type')} status={el.get('status')} "
            f"text={text!r} contrast={contrast}"
        )
    if len(elements) > max_items:
        lines.append(f"  ... and {len(elements) - max_items} more element(s)")

    return "DETECTED ELEMENTS:\n" + "\n".join(lines)
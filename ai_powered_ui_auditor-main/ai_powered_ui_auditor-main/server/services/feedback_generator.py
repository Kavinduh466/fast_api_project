"""
UIGen Audit Pipeline — 6-Phase Feedback Generator
===================================================
Phase 1: Screenshot + JSON       → Gemini → Annotated image with error suggestions (RED)
Phase 2: Scored/analyzed image   → Gemini → Annotated image with improvement suggestions (BLUE)
Phase 3: JSON + analyzed + real  → Gemini → Cross-analysis annotated image (GREEN)
Phase 5: All phase findings      → Gemini → Design improvement prompt (.txt)
Phase 6: Real UI + Phase 5 prompt → Gemini image gen → Improved UI design image

Ported from UIGen_audit/audit.py into the server service layer.
"""

import io
import json
import os
import re
import uuid
import urllib.parse

import requests as http_requests
from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

from server.config import GEMINI_API_KEY, UPLOAD_DIR, WEIGHTS_DIR


# ---------------------------------------------------------------------------
# Gemini client (lazy singleton)
# ---------------------------------------------------------------------------
_client = None

def _get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
COLOR_PHASE1 = (220, 50, 50)    # red   — Phase 1 error suggestions
COLOR_PHASE2 = (50, 130, 220)   # blue  — Phase 2 score-based suggestions
COLOR_PHASE3 = (40, 180, 90)    # green — Phase 3 cross-analysis suggestions
FONT_COLOR   = (255, 255, 255)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_font(size: int):
    for name in ["arial.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def draw_annotation(draw: ImageDraw.ImageDraw, bbox, label: str,
                    color, font, padding: int = 6):
    img_w, img_h = draw.im.size
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(int(x1), img_w - 1))
    y1 = max(0, min(int(y1), img_h - 1))
    x2 = max(x1 + 1, min(int(x2), img_w - 1))
    y2 = max(y1 + 1, min(int(y2), img_h - 1))
    draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
    tw, th = draw.textbbox((0, 0), label, font=font)[2:]
    lx2 = max(x1 + 1, min(x1 + tw + padding * 2, img_w - 1))
    label_y0 = max(0, y1 - th - padding * 2)
    label_y1 = max(label_y0 + 1, y1)
    draw.rectangle([x1, label_y0, lx2, label_y1], fill=color)
    draw.text((x1 + padding, label_y0 + padding // 2), label,
              fill=FONT_COLOR, font=font)


def ask_gemini(client, images, prompt: str) -> str:
    """Send one or more PIL Images + a text prompt to Gemini, return response text."""
    if not isinstance(images, list):
        images = [images]
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=images + [prompt],
    )
    return response.text.strip()


def parse_json_from_response(text: str):
    """Extract and parse the first JSON array found in Gemini's response."""
    match = re.search(r'\[.*?\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return [{"suggestion": text[:80].strip(), "area": "center", "element": "overall"}]


def area_to_bbox(area: str, img_w: int, img_h: int):
    area = area.lower().strip()
    regions = {
        "top":          (0,          0,          img_w,          img_h // 5),
        "upper-left":   (0,          0,          img_w // 2,     img_h // 2),
        "upper-right":  (img_w // 2, 0,          img_w,          img_h // 2),
        "center":       (img_w // 4, img_h // 4, 3*img_w // 4,  3*img_h // 4),
        "lower-left":   (0,          img_h // 2, img_w // 2,     img_h),
        "lower-right":  (img_w // 2, img_h // 2, img_w,          img_h),
        "bottom":       (0,          4*img_h//5, img_w,          img_h),
    }
    return regions.get(area, regions["center"])


# ---------------------------------------------------------------------------
# Phase 1 — Screenshot + JSON → Gemini → annotated image (RED)
# ---------------------------------------------------------------------------

def phase1(image: Image.Image, audit_data: dict, client, font):
    """Returns (annotated_image, list_of_suggestion_strings)."""
    print("\n[Phase 1] Screenshot + JSON → Gemini error suggestions …")
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    suggestions = []

    fail_elements = [el for el in audit_data.get("elements", []) if el.get("status") == "FAIL"]
    if not fail_elements:
        print("  No FAIL elements in JSON — skipping annotations.")
        return annotated, suggestions

    for el in fail_elements:
        bbox    = el.get("bbox")
        if not bbox:
            continue
        el_type = el.get("type", "element")
        text    = el.get("content", {}).get("text", "") if isinstance(el.get("content"), dict) else ""
        issues  = "; ".join(i.get("desc", "") for i in el.get("issues", []))

        prompt = (
            f"You are auditing a UI screenshot. "
            f"A UI element of type '{el_type}' with label '{text}' has these violations: {issues}. "
            f"Give one concise fix suggestion in max 10 words."
        )
        suggestion = ask_gemini(client, image, prompt)
        short = suggestion[:60] + "…" if len(suggestion) > 60 else suggestion
        print(f"  [id={el.get('id', '?')}] {text or el_type}: {suggestion}")
        draw_annotation(draw, bbox, short, COLOR_PHASE1, font)
        suggestions.append(f"{text or el_type}: {suggestion}")

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 2 — Scored/analyzed image → Gemini → annotated image (BLUE)
# ---------------------------------------------------------------------------

def phase2(analyzed_image: Image.Image, audit_data: dict, client, font):
    """Returns (annotated_image, list_of_suggestion_strings)."""
    print("\n[Phase 2] Scored UI image → Gemini improvement suggestions …")
    annotated = analyzed_image.copy()
    draw = ImageDraw.Draw(annotated)
    suggestions = []

    overall_score = audit_data.get("summary", {}).get("score", "N/A")
    violations    = audit_data.get("summary", {}).get("violations", 0)
    img_w, img_h  = analyzed_image.size

    prompt = (
        f"This image shows a UI with detected elements scored against expert UI standards. "
        f"Overall score: {overall_score}/100 with {violations} violations. "
        f"Examine the image carefully and give exactly 4 specific UI improvement suggestions. "
        f"Respond ONLY with a JSON array. Each item must have: "
        f"\"suggestion\" (max 10 words) and \"area\" (one of: top, upper-left, upper-right, "
        f"center, lower-left, lower-right, bottom). "
        f"Example: [{{\"suggestion\": \"Increase button height to meet standards\", \"area\": \"bottom\"}}]"
    )
    raw   = ask_gemini(client, analyzed_image, prompt)
    items = parse_json_from_response(raw)

    for item in items[:4]:
        suggestion = item.get("suggestion", "")
        area       = item.get("area", "center")
        bbox       = area_to_bbox(area, img_w, img_h)
        short      = suggestion[:60] + "…" if len(suggestion) > 60 else suggestion
        print(f"  [{area}] {suggestion}")
        draw_annotation(draw, bbox, short, COLOR_PHASE2, font)
        suggestions.append(suggestion)

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 3 — JSON + analyzed image + real UI → Gemini → annotated image (GREEN)
# ---------------------------------------------------------------------------

def phase3(image: Image.Image, analyzed_image: Image.Image,
           audit_data: dict, client, font):
    """Returns (annotated_image, list_of_suggestion_strings)."""
    print("\n[Phase 3] Cross-analysis (real UI + scored image + JSON) → Gemini …")
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    suggestions = []

    overall_score = audit_data.get("summary", {}).get("score", "N/A")
    violations    = audit_data.get("summary", {}).get("violations", 0)
    img_w, img_h  = image.size

    el_lines = []
    for el in audit_data.get("elements", []):
        content = el.get("content", {})
        if isinstance(content, dict):
            label = content.get("text", "") or el.get("type", "")
        else:
            label = el.get("type", "")
        status = el.get("status", "")
        issues = "; ".join(i.get("desc", "") for i in el.get("issues", []))
        el_lines.append(f"{label} [{status}]: {issues}" if issues else f"{label} [{status}]")
    json_summary = f"Score {overall_score}/100, {violations} violations. " + " | ".join(el_lines)

    element_bbox = {}
    for el in audit_data.get("elements", []):
        content = el.get("content", {})
        if isinstance(content, dict):
            label = (content.get("text", "") or el.get("type", "")).lower().strip()
        else:
            label = el.get("type", "").lower().strip()
        if label and el.get("bbox"):
            element_bbox[label] = el["bbox"]

    fallback_bboxes = [
        (10,          10,           img_w // 3,   img_h // 8),
        (img_w // 3,  10,           2*img_w // 3, img_h // 8),
        (2*img_w//3,  10,           img_w - 10,   img_h // 8),
        (10,          img_h - img_h//8, img_w//2, img_h - 10),
        (img_w // 2,  img_h - img_h//8, img_w-10, img_h - 10),
    ]

    prompt = (
        f"You are doing a comprehensive UI audit. "
        f"Image 1 is the original UI screenshot. Image 2 is the scored analysis image. "
        f"JSON summary: {json_summary}. "
        f"Compare both images and the data. Give exactly 5 cross-analysis improvement suggestions. "
        f"Respond ONLY with a JSON array. Each item must have: "
        f"\"suggestion\" (max 12 words) and \"element\" (the text label of the most relevant UI "
        f"element from the JSON summary, or 'overall'). "
        f"Example: [{{\"suggestion\": \"Login button is too small for touch targets\", \"element\": \"LOGIN\"}}]"
    )
    raw   = ask_gemini(client, [image, analyzed_image], prompt)
    items = parse_json_from_response(raw)

    for i, item in enumerate(items[:5]):
        suggestion  = item.get("suggestion", "")
        element_ref = item.get("element", "overall").lower().strip()

        bbox = None
        for key, val in element_bbox.items():
            if element_ref in key or key in element_ref:
                bbox = val
                break
        if bbox is None:
            bbox = fallback_bboxes[i % len(fallback_bboxes)]

        short = suggestion[:60] + "…" if len(suggestion) > 60 else suggestion
        print(f"  [{element_ref}] {suggestion}")
        draw_annotation(draw, bbox, short, COLOR_PHASE3, font)
        suggestions.append(suggestion)

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 5 — All findings → Gemini → design improvement prompt
# ---------------------------------------------------------------------------

def phase5(image: Image.Image, p1_suggestions: list, p2_suggestions: list,
           p3_suggestions: list, audit_data: dict, client, out_path: str) -> str:
    """Ask Gemini to synthesise all findings into a detailed design prompt.
    Saves the prompt to out_path and returns the prompt string."""
    print("\n[Phase 5] Synthesising findings → design improvement prompt …")

    overall_score = audit_data.get("summary", {}).get("score", "N/A")
    violations    = audit_data.get("summary", {}).get("violations", 0)

    all_findings = (
        f"UI audit score: {overall_score}/100 with {violations} violations.\n"
        f"Phase 1 – Error fixes: {'; '.join(p1_suggestions) or 'none'}\n"
        f"Phase 2 – Score-based improvements: {'; '.join(p2_suggestions) or 'none'}\n"
        f"Phase 3 – Cross-analysis insights: {'; '.join(p3_suggestions) or 'none'}"
    )

    prompt = (
        f"You are a senior UI/UX designer. Based on this UI audit:\n{all_findings}\n\n"
        f"Also examine the provided UI screenshot carefully.\n"
        f"Write a detailed, specific prompt that can be used to generate an improved version "
        f"of this UI. The prompt should describe: layout improvements, colour palette, "
        f"typography, spacing, component sizes, visual hierarchy, and overall style. "
        f"Be specific about what to change and what to keep. Max 150 words. "
        f"Return ONLY the prompt text, no headers or extra commentary."
    )
    design_prompt = ask_gemini(client, image, prompt)
    print(f"  Generated prompt ({len(design_prompt)} chars)")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(design_prompt)
    print(f"  Saved: {out_path}")

    return design_prompt


# ---------------------------------------------------------------------------
# Phase 6 — Real UI + Phase 5 prompt → Gemini image gen → improved UI
# ---------------------------------------------------------------------------

def phase6(image: Image.Image, design_prompt: str, api_key: str, out_path: str):
    """Generate an improved UI design using Gemini image generation.

    Tries in order:
      1. gemini-2.5-flash-image (image-to-image, best quality)
      2. gemini-2.0-flash-exp-image-generation (image-to-image)
      3. imagen-4.0-fast-generate-001 / imagen-4.0-generate-001 (text-to-image)
      4. Pollinations.ai (free, no key needed, slower)

    Saves the generated image to out_path and returns it, or returns None.
    """
    print("\n[Phase 6] Generating improved UI design with Gemini …")

    full_prompt = (
        f"You are a UI designer. Here is the current UI screenshot. "
        f"Redesign and improve it following these instructions exactly:\n\n{design_prompt}\n\n"
        f"Generate a clean, polished, high-fidelity UI mockup that addresses all the improvements. "
        f"Keep the same general layout and purpose but apply all the suggested enhancements."
    )

    client = genai.Client(api_key=api_key)
    generated_image = None

    # --- Attempt 1: Gemini image-to-image models ---
    for gen_model in ["gemini-2.5-flash-image", "gemini-2.0-flash-exp-image-generation"]:
        try:
            print(f"  Trying {gen_model} …")
            response = client.models.generate_content(
                model=gen_model,
                contents=[image, full_prompt],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data is not None:
                    generated_image = Image.open(io.BytesIO(part.inline_data.data))
                    print(f"  {gen_model} generated an image.")
                    break
            if generated_image:
                break
            print(f"  {gen_model} returned no image — trying next …")
        except Exception as e:
            print(f"  {gen_model} failed: {e}")

    # --- Attempt 2: Imagen text-to-image ---
    if generated_image is None:
        for imagen_model in ["imagen-4.0-fast-generate-001", "imagen-4.0-generate-001"]:
            try:
                print(f"  Trying {imagen_model} …")
                imagen_prompt = (
                    f"High-fidelity UI mockup. {design_prompt} "
                    f"Clean, modern, polished interface design."
                )
                img_response = client.models.generate_images(
                    model=imagen_model,
                    prompt=imagen_prompt,
                    config=types.GenerateImagesConfig(number_of_images=1),
                )
                if img_response.generated_images:
                    raw = img_response.generated_images[0].image.image_bytes
                    generated_image = Image.open(io.BytesIO(raw))
                    print(f"  {imagen_model} generated an image.")
                    break
            except Exception as e:
                print(f"  {imagen_model} failed: {e}")

    # --- Attempt 3: Pollinations.ai (free fallback) ---
    if generated_image is None:
        short_prompt = (
            f"UI mockup design, {design_prompt[:200]}, "
            f"clean modern interface, polished, professional, high fidelity."
        )
        encoded = urllib.parse.quote(short_prompt)
        for model in ["flux", "turbo"]:
            try:
                url = (f"https://image.pollinations.ai/prompt/{encoded}"
                       f"?model={model}&width=1024&height=1024&nologo=true&seed=42")
                print(f"  Trying Pollinations ({model}) — this may take up to 3 minutes …")
                resp = http_requests.get(url, timeout=180)
                resp.raise_for_status()
                generated_image = Image.open(io.BytesIO(resp.content))
                print(f"  Pollinations ({model}) generated an image.")
                break
            except Exception as e:
                print(f"  Pollinations ({model}) failed: {e}")

    if generated_image is None:
        print("  Phase 6 could not generate an image.")
        return None

    generated_image.save(out_path)
    print(f"  Saved: {out_path}")
    return generated_image


# ---------------------------------------------------------------------------
# Generate analyzed image (if not provided)
# ---------------------------------------------------------------------------

def generate_analyzed_image(image: Image.Image, audit_data: dict, font,
                            yolo_model_path: str = "yolov8n.pt") -> Image.Image:
    """Run YOLO on the screenshot and overlay scores to create an analyzed image."""
    print("  Running YOLO to generate analyzed image …")
    try:
        yolo = YOLO(yolo_model_path)
    except Exception:
        yolo = YOLO("yolov8n.pt")

    results = yolo(image, verbose=False)

    analyzed = image.copy()
    draw     = ImageDraw.Draw(analyzed)
    boxes    = results[0].boxes

    if boxes is not None:
        for box in boxes:
            coords   = [int(c) for c in box.xyxy[0].tolist()]
            conf     = float(box.conf[0])
            cls_name = yolo.names[int(box.cls[0])]
            label    = f"{cls_name} {conf:.0%}"
            color    = (50, 200, 50) if conf >= 0.7 else (220, 50, 50)
            draw.rectangle([coords[0], coords[1], coords[2], coords[3]], outline=color, width=2)
            draw.text((coords[0], max(0, coords[1] - 20)), label, fill=color, font=font)

    w, h        = analyzed.size
    score       = audit_data.get("summary", {}).get("score", "N/A")
    violations  = audit_data.get("summary", {}).get("violations", 0)
    banner_font = load_font(22)
    draw.rectangle([0, 0, w, 48], fill=(20, 20, 20))
    draw.text((10, 10),
              f"UI Score: {score}/100  |  Violations: {violations}  |  YOLO Element Analysis",
              fill=(255, 220, 50), font=banner_font)

    return analyzed


# ---------------------------------------------------------------------------
# Main pipeline entry point
# ---------------------------------------------------------------------------

def run_feedback_pipeline(ui_image_path: str, json_file_path: str = "",
                          yolo_model_path: str = "yolov8n.pt") -> dict:
    """
    Runs the full 6-phase UI audit pipeline.
    Returns a dict with paths to generated images and text output.
    """
    print("\n========== UIGen Audit Pipeline ==========")

    # Load image
    image = Image.open(ui_image_path).convert("RGB")

    # Load audit JSON (may be empty)
    audit_data = {"elements": [], "summary": {"score": "N/A", "violations": 0}}
    if json_file_path and os.path.isfile(json_file_path):
        with open(json_file_path) as f:
            audit_data = json.load(f)
        # Ensure summary exists
        if "summary" not in audit_data:
            elements = audit_data.get("elements", [])
            fail_count = sum(1 for el in elements if el.get("status") == "FAIL")
            audit_data["summary"] = {
                "score": max(0, 100 - fail_count * 10),
                "violations": fail_count,
            }

    client = _get_client()
    font   = load_font(18)
    req_id = uuid.uuid4().hex[:8]

    # Generate analyzed/scored image via YOLO
    analyzed_image = generate_analyzed_image(image, audit_data, font, yolo_model_path)

    # --- Phase 1: Error fix suggestions (RED) ---
    p1_img, p1_suggestions = phase1(image, audit_data, client, font)
    p1_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_phase1.png")
    p1_img.save(p1_path)
    print(f"  Saved: {p1_path}")

    # --- Phase 2: Score-based improvements (BLUE) ---
    p2_img, p2_suggestions = phase2(analyzed_image, audit_data, client, font)
    p2_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_phase2.png")
    p2_img.save(p2_path)
    print(f"  Saved: {p2_path}")

    # --- Phase 3: Cross-analysis (GREEN) ---
    p3_img, p3_suggestions = phase3(image, analyzed_image, audit_data, client, font)
    p3_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_phase3.png")
    p3_img.save(p3_path)
    print(f"  Saved: {p3_path}")

    # --- Phase 5: Design prompt synthesis ---
    p5_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_phase5.txt")
    design_prompt = phase5(image, p1_suggestions, p2_suggestions, p3_suggestions,
                           audit_data, client, p5_path)

    # --- Phase 6: AI-generated improved UI ---
    p6_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_phase6.png")
    phase6_img = phase6(image, design_prompt, GEMINI_API_KEY, p6_path)

    # Build synthesis message from top suggestions
    top_suggestions = (p1_suggestions + p2_suggestions + p3_suggestions)[:3]
    synthesis_message = "; ".join(top_suggestions) if top_suggestions else "UI analysis complete"

    result = {
        "status": "success",
        "images": {
            "phase1_technical": f"/feedback/report/{req_id}_phase1",
            "phase2_aesthetic": f"/feedback/report/{req_id}_phase2",
            "phase3_synthesis": f"/feedback/report/{req_id}_phase3",
        },
        "synthesis_message": synthesis_message,
        "design_prompt": design_prompt,
        "generator_prompt": design_prompt,  # backward compat alias
    }

    if phase6_img is not None:
        result["images"]["phase6_generated"] = f"/feedback/report/{req_id}_phase6"

    print("\n========== Pipeline complete ==========")
    return result

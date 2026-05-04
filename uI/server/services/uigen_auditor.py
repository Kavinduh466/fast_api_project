"""
UIGen Audit Service
===================
Server-side wrapper around the UIGen audit pipeline (6-phase system).
Runs phases 1-3 (annotated images), phase 5 (design prompt), and phase 6
(AI-generated improved UI) given a UI screenshot and audit JSON data.
"""

import io
import json
import os
import re
import textwrap
import urllib.parse
import uuid
from pathlib import Path

import requests
from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

from server.config import GEMINI_API_KEY, UPLOAD_DIR


# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
COLOR_PHASE1 = (220, 50,  50)   # red
COLOR_PHASE2 = (50,  130, 220)  # blue
COLOR_PHASE3 = (40,  180, 90)   # green
FONT_COLOR   = (255, 255, 255)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_font(size: int):
    for name in ["arial.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _draw_annotation(draw: ImageDraw.ImageDraw, bbox, label: str,
                     color, font, padding: int = 6):
    img_w, img_h = draw.im.size
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(int(x1), img_w - 1))
    y1 = max(0, min(int(y1), img_h - 1))
    x2 = max(x1 + 1, min(int(x2), img_w - 1))
    y2 = max(y1 + 1, min(y2, img_h - 1))
    draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
    tw, th = draw.textbbox((0, 0), label, font=font)[2:]
    lx2 = max(x1 + 1, min(x1 + tw + padding * 2, img_w - 1))
    label_y0 = max(0, y1 - th - padding * 2)
    label_y1 = max(label_y0 + 1, y1)
    draw.rectangle([x1, label_y0, lx2, label_y1], fill=color)
    draw.text((x1 + padding, label_y0 + padding // 2), label,
              fill=FONT_COLOR, font=font)


def _ask_gemini(client, images, prompt: str) -> str:
    if not isinstance(images, list):
        images = [images]
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=images + [prompt],
    )
    return response.text.strip()


def _parse_json_from_response(text: str):
    match = re.search(r'\[.*?\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return [{"suggestion": text[:80].strip(), "area": "center", "element": "overall"}]


def _area_to_bbox(area: str, img_w: int, img_h: int):
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
# Phase 1 — Screenshot + JSON → Gemini → annotated image
# ---------------------------------------------------------------------------

def _phase1(image: Image.Image, audit_data: dict, client, font):
    print("\n[UIGen Phase 1] Screenshot + JSON → Gemini error suggestions …")
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    suggestions = []

    fail_elements = [el for el in audit_data.get("elements", []) if el.get("status") == "FAIL"]
    if not fail_elements:
        print("  No FAIL elements — skipping.")
        return annotated, suggestions

    for el in fail_elements:
        bbox    = el["bbox"]
        el_type = el.get("type", "element")
        text    = el.get("content", {}).get("text", "")
        issues  = "; ".join(i["desc"] for i in el.get("issues", []))

        prompt = (
            f"You are auditing a UI screenshot. "
            f"A UI element of type '{el_type}' with label '{text}' has these violations: {issues}. "
            f"Give one concise fix suggestion in max 10 words."
        )
        suggestion = _ask_gemini(client, image, prompt)
        short = suggestion[:60] + "…" if len(suggestion) > 60 else suggestion
        _draw_annotation(draw, bbox, short, COLOR_PHASE1, font)
        suggestions.append(f"{text or el_type}: {suggestion}")

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 2 — Scored/analyzed image → Gemini → annotated image
# ---------------------------------------------------------------------------

def _phase2(analyzed_image: Image.Image, audit_data: dict, client, font):
    print("\n[UIGen Phase 2] Scored UI image → Gemini improvement suggestions …")
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
    raw   = _ask_gemini(client, analyzed_image, prompt)
    items = _parse_json_from_response(raw)

    for item in items[:4]:
        suggestion = item.get("suggestion", "")
        area       = item.get("area", "center")
        bbox       = _area_to_bbox(area, img_w, img_h)
        short      = suggestion[:60] + "…" if len(suggestion) > 60 else suggestion
        _draw_annotation(draw, bbox, short, COLOR_PHASE2, font)
        suggestions.append(suggestion)

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 3 — JSON + analyzed + real → Gemini → annotated image
# ---------------------------------------------------------------------------

def _phase3(image: Image.Image, analyzed_image: Image.Image,
            audit_data: dict, client, font):
    print("\n[UIGen Phase 3] Cross-analysis → Gemini …")
    annotated = image.copy()
    draw = ImageDraw.Draw(annotated)
    suggestions = []

    overall_score = audit_data.get("summary", {}).get("score", "N/A")
    violations    = audit_data.get("summary", {}).get("violations", 0)
    img_w, img_h  = image.size

    el_lines = []
    for el in audit_data.get("elements", []):
        label  = el.get("content", {}).get("text", "") or el.get("type", "")
        status = el.get("status", "")
        issues = "; ".join(i["desc"] for i in el.get("issues", []))
        el_lines.append(f"{label} [{status}]: {issues}" if issues else f"{label} [{status}]")
    json_summary = f"Score {overall_score}/100, {violations} violations. " + " | ".join(el_lines)

    element_bbox = {}
    for el in audit_data.get("elements", []):
        label = (el.get("content", {}).get("text", "") or el.get("type", "")).lower().strip()
        if label:
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
    raw   = _ask_gemini(client, [image, analyzed_image], prompt)
    items = _parse_json_from_response(raw)

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
        _draw_annotation(draw, bbox, short, COLOR_PHASE3, font)
        suggestions.append(suggestion)

    return annotated, suggestions


# ---------------------------------------------------------------------------
# Phase 5 — All findings → Gemini → design improvement prompt
# ---------------------------------------------------------------------------

def _phase5(image: Image.Image, p1_suggestions: list, p2_suggestions: list,
            p3_suggestions: list, audit_data: dict, client) -> str:
    print("\n[UIGen Phase 5] Synthesising findings → design prompt …")

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
    design_prompt = _ask_gemini(client, image, prompt)
    print(f"  Generated prompt ({len(design_prompt)} chars)")
    return design_prompt


# ---------------------------------------------------------------------------
# Phase 6 — Real UI + prompt → Gemini image gen → improved UI
# ---------------------------------------------------------------------------

def _phase6(image: Image.Image, design_prompt: str, api_key: str, out_path: str):
    print("\n[UIGen Phase 6] Generating improved UI design …")

    full_prompt = (
        f"You are a UI designer. Here is the current UI screenshot. "
        f"Redesign and improve it following these instructions exactly:\n\n{design_prompt}\n\n"
        f"Generate a clean, polished, high-fidelity UI mockup that addresses all the improvements. "
        f"Keep the same general layout and purpose but apply all the suggested enhancements."
    )

    client = genai.Client(api_key=api_key)
    generated_image = None

    # --- Attempt 1: Gemini image models ---
    for gen_model in ["gemini-2.5-flash-preview-native-audio-dialog", "gemini-2.0-flash-exp-image-generation"]:
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

    # --- Attempt 2: Imagen ---
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

    # --- Attempt 3: Pollinations.ai ---
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
                print(f"  Trying Pollinations ({model}) …")
                resp = requests.get(url, timeout=180)
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
# Generate analyzed image (YOLO overlay)
# ---------------------------------------------------------------------------

def _generate_analyzed_image(image: Image.Image, audit_data: dict, font) -> Image.Image:
    print("  Running YOLO to generate analyzed image …")
    yolo    = YOLO("yolov8n.pt")
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
    banner_font = _load_font(22)
    draw.rectangle([0, 0, w, 48], fill=(20, 20, 20))
    draw.text((10, 10),
              f"UI Score: {score}/100  |  Violations: {violations}  |  YOLO Element Analysis",
              fill=(255, 220, 50), font=banner_font)

    return analyzed


# ---------------------------------------------------------------------------
# Public API — run_uigen_pipeline
# ---------------------------------------------------------------------------

def run_uigen_pipeline(ui_image_path: str, audit_json_path: str = "") -> dict:
    """
    Run the full UIGen 6-phase audit pipeline.

    Args:
        ui_image_path:  Path to the uploaded UI screenshot.
        audit_json_path: Path to the JSON audit file (optional).

    Returns:
        dict with status, image URLs, design_prompt, etc.
    """
    try:
        image = Image.open(ui_image_path).convert("RGB")
    except Exception as e:
        return {"error": f"Could not open image: {e}"}

    # Load or create audit data
    audit_data = {"elements": [], "summary": {"score": "N/A", "violations": 0}}
    if audit_json_path and os.path.isfile(audit_json_path):
        with open(audit_json_path) as f:
            audit_data = json.load(f)

    client = genai.Client(api_key=GEMINI_API_KEY)
    font   = _load_font(18)

    # Generate analyzed image (YOLO overlay)
    analyzed_image = _generate_analyzed_image(image, audit_data, font)

    # Phase 1
    p1_img, p1_suggestions = _phase1(image, audit_data, client, font)
    # Phase 2
    p2_img, p2_suggestions = _phase2(analyzed_image, audit_data, client, font)
    # Phase 3
    p3_img, p3_suggestions = _phase3(image, analyzed_image, audit_data, client, font)
    # Phase 5 — design prompt
    design_prompt = _phase5(image, p1_suggestions, p2_suggestions,
                            p3_suggestions, audit_data, client)

    # Save phase outputs
    req_id = uuid.uuid4().hex[:8]
    images = {}

    p1_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_uigen_p1.png")
    p1_img.save(p1_path)
    images["phase1"] = f"/uigen/image/{req_id}_uigen_p1.png"

    p2_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_uigen_p2.png")
    p2_img.save(p2_path)
    images["phase2"] = f"/uigen/image/{req_id}_uigen_p2.png"

    p3_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_uigen_p3.png")
    p3_img.save(p3_path)
    images["phase3"] = f"/uigen/image/{req_id}_uigen_p3.png"

    # Phase 6 — AI-generated improved UI
    p6_path = os.path.join(str(UPLOAD_DIR), f"{req_id}_uigen_p6.png")
    p6_result = _phase6(image, design_prompt, GEMINI_API_KEY, p6_path)
    if p6_result is not None:
        images["phase6_improved"] = f"/uigen/image/{req_id}_uigen_p6.png"

    print(f"\n[UIGen] Pipeline complete — req_id={req_id}")

    return {
        "status": "success",
        "request_id": req_id,
        "images": images,
        "design_prompt": design_prompt,
        "suggestions": {
            "phase1": p1_suggestions,
            "phase2": p2_suggestions,
            "phase3": p3_suggestions,
        },
    }

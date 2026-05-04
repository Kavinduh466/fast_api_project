import cv2
import numpy as np
from ultralytics import YOLO
import json
import os
import time
import threading
import PIL.Image
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from google import genai
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from server.config import GEMINI_API_KEY, UPLOAD_DIR

client = genai.Client(api_key=GEMINI_API_KEY)

# Gentle global throttle so we don't hammer Gemini's free tier.
# Each call waits at most GEMINI_MIN_GAP_SEC after the previous one, but
# concurrent requests past the first batch only wait as needed (not per-call).
_GEMINI_LOCK = threading.Lock()
_LAST_GEMINI_CALL_TS = 0.0
GEMINI_MIN_GAP_SEC = 0.6     # was an unconditional 2-4s sleep per call
GEMINI_MAX_RETRIES = 2       # retry on transient 503 UNAVAILABLE only
GEMINI_RETRY_BASE_DELAY = 1.2
GEMINI_PARALLEL_WORKERS = 4

# gemini-2.5-flash-lite has a far more generous free-tier quota than 2.5-flash
# (which caps at 20 requests/day) and is actually enabled on the free tier
# (2.0-flash currently reports limit=0 for new free-tier projects).
# Override with GEMINI_MODEL env var if needed.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")


def _throttle_gemini() -> None:
    """Ensure at least GEMINI_MIN_GAP_SEC between any two Gemini calls."""
    global _LAST_GEMINI_CALL_TS
    with _GEMINI_LOCK:
        now = time.time()
        wait = GEMINI_MIN_GAP_SEC - (now - _LAST_GEMINI_CALL_TS)
        if wait > 0:
            time.sleep(wait)
        _LAST_GEMINI_CALL_TS = time.time()


def _is_transient_gemini_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "503" in msg
        or "unavailable" in msg
        or "overloaded" in msg
        or "deadline" in msg
        or "temporarily" in msg
    )

# --- HELPER FUNCTIONS ---

def _humanize_rule_id(rule_id: str) -> str:
    """'min_button_height' -> 'Min Button Height'."""
    return str(rule_id).replace("_", " ").replace("-", " ").strip().title()


def _issue_label_and_desc(issue: dict) -> tuple[str, str]:
    """Extract (short_label, full_description) from a SINGLE issue dict."""
    # Ensure issue is a dict
    if not isinstance(issue, dict):
        return "UI Violation", "Invalid issue structure"
    
    full_desc = ""
    for key in ("description", "desc", "message", "text"):
        val = issue.get(key)
        if isinstance(val, str) and val.strip():
            full_desc = val.strip()
            break

    short_label = ""
    for key in ("rule_name", "title"):
        val = issue.get(key)
        if isinstance(val, str) and val.strip():
            short_label = val.strip()
            break
    if not short_label:
        for key in ("rule_id", "rule"):
            val = issue.get(key)
            if isinstance(val, str) and val.strip():
                short_label = _humanize_rule_id(val)
                break
    if not short_label and full_desc:
        short_label = full_desc[:40] + ("…" if len(full_desc) > 40 else "")

    return short_label, full_desc


def _extract_issue_context(element: dict) -> tuple[str, str]:
    """
    Pull (short_label, full_description) from a FAIL element.

    If the element has MULTIPLE issues (e.g. a button violates both
    min_button_height AND contrast_ratio), both are reflected:
      - short_label is combined so the annotation shows all rule names
      - full_description lists every violation so Gemini sees them all

    Handles real-world field-name variations:
      - comp1 metric rules write  issue["description"]  (+ rule_id / rule_name)
      - older / frontend entries  write issue["desc"]   (+ rule)
      - comp2 FAILs may have no issue at all — synthesize from similarity_score
    """
    issues = element.get("issues") or []
    # Keep only dict-shaped issues with some content
    issue_dicts = [i for i in issues if isinstance(i, dict)]

    if issue_dicts:
        labels: list[str] = []
        descs: list[str] = []
        for issue in issue_dicts:
            try:
                result = _issue_label_and_desc(issue)
                if not isinstance(result, tuple) or len(result) != 2:
                    print(f"⚠️ Warning: _issue_label_and_desc returned unexpected result: {result}")
                    continue
                lbl, dsc = result
                if lbl and lbl not in labels:
                    labels.append(lbl)
                if dsc and dsc not in descs:
                    descs.append(dsc)
            except ValueError as e:
                print(f"⚠️ Error unpacking result from _issue_label_and_desc: {e}")
                continue

        if not labels and not descs:
            pass  # fall through to comp2 / default
        else:
            # Combine into one compact on-image label
            if len(labels) == 0:
                short_label = "UI Violation"
            elif len(labels) == 1:
                short_label = labels[0]
            elif len(labels) == 2:
                short_label = f"{labels[0]} + {labels[1]}"
            else:
                short_label = f"{labels[0]} +{len(labels) - 1} more"

            # Full description: enumerate all violations so Gemini + the text
            # report can see every single one.
            if len(descs) <= 1:
                full_desc = descs[0] if descs else short_label
            else:
                full_desc = (
                    f"{len(descs)} rule violations on this element:\n- "
                    + "\n- ".join(descs)
                )
            return short_label, full_desc

    # comp2_element_audit: synthesize from similarity score
    sim = element.get("similarity_score")
    cls = element.get("class") or element.get("type")
    if sim is not None and cls:
        try:
            sim_val = float(sim)
            short = f"Low similarity: {cls}"
            full = f"'{cls}' element scores only {sim_val:.0f}% similarity vs expert-library patterns."
            return short, full
        except (TypeError, ValueError):
            pass

    return "UI Violation", "UI element flagged by audit (no rule description available)."


def _overlay_shorten(text: str, max_len: int) -> str:
    """Single-line label for on-image overlay (no newlines)."""
    s = (text or "").strip().replace("\n", " ")
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _callout_rects_overlap(
    ax1: int, ay1: int, ax2: int, ay2: int,
    bx1: int, by1: int, bx2: int, by2: int,
    pad: int = 12,
) -> bool:
    """True if axis-aligned rectangles overlap (with breathing room)."""
    return not (
        ax2 + pad <= bx1
        or bx2 + pad <= ax1
        or ay2 + pad <= by1
        or by2 + pad <= ay1
    )


def _load_audit_ui_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Prefer modern system UI fonts (Segoe UI / SF / DejaVu) for callout text."""
    windir = os.environ.get("WINDIR", r"C:\Windows")
    candidates = [
        os.path.join(windir, "Fonts", "segoeui.ttf"),
        os.path.join(windir, "Fonts", "seguisb.ttf"),
        "/System/Library/Fonts/SFNSText.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _pil_text_size(font: ImageFont.ImageFont, text: str) -> tuple[int, int]:
    im = Image.new("RGB", (4, 4))
    dr = ImageDraw.Draw(im)
    l, t, r, b = dr.textbbox((0, 0), text, font=font)
    return max(1, r - l), max(1, b - t)


def _orthogonal_polyline(
    p0: tuple[int, int],
    p1: tuple[int, int],
) -> list[tuple[int, int]]:
    """
    L-shaped route between two anchors so leaders cross less than straight diagonals.
    """
    x0, y0 = p0
    x1, y1 = p1
    if abs(x1 - x0) < 4 or abs(y1 - y0) < 4:
        return [p0, p1]
    if abs(x1 - x0) >= abs(y1 - y0):
        knee = (x1, y0)
    else:
        knee = (x0, y1)
    if knee == p0 or knee == p1:
        return [p0, p1]
    return [p0, knee, p1]


def _leader_anchor_points(
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    bx1: int,
    by_top: int,
    bx2: int,
    y_bottom: int,
) -> tuple[tuple[int, int], tuple[int, int]]:
    """
    Panel anchor and bbox anchor for a connector so each callout reads as tied
    to exactly one outlined component.
    """
    tcx, tcy = (x1 + x2) // 2, (y1 + y2) // 2
    pcx = (bx1 + bx2) // 2
    m = 4

    if y_bottom <= y1 - 1:
        py = min(y_bottom, y1 - 1)
        return (pcx, py), (tcx, y1 + m)
    if by_top >= y2 + 1:
        py = max(by_top, y2 + 1)
        return (pcx, py), (tcx, y2 - m)
    if bx1 >= x2 + 1:
        mid_py = max(by_top + m, min(y_bottom - m, (by_top + y_bottom) // 2))
        return (bx1, mid_py), (x2 - m, max(y1 + m, min(y2 - m, tcy)))
    if bx2 <= x1 - 1:
        mid_py = max(by_top + m, min(y_bottom - m, (by_top + y_bottom) // 2))
        return (bx2, mid_py), (x1 + m, max(y1 + m, min(y2 - m, tcy)))
    if y_bottom < tcy:
        return (pcx, y_bottom), (tcx, y1 + m)
    return (pcx, by_top), (tcx, y2 - m)


def _find_callout_origin(
    iw: int,
    ih: int,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    box_w: int,
    box_h: int,
    occupied: list[tuple[int, int, int, int]],
) -> tuple[int, int]:
    """
    Pick (bx1, by_top) for the callout panel so it stays on-screen and does not
    overlap existing panels (fixes dense rows of violations at the bottom).
    """
    cx = (x1 + x2) // 2
    gap = 16

    def fits(bx: int, by: int) -> bool:
        if bx < 2 or by < 2 or bx + box_w > iw - 2 or by + box_h > ih - 2:
            return False
        rect = (bx, by, bx + box_w, by + box_h)
        return not any(_callout_rects_overlap(*rect, *o) for o in occupied)

    dx_steps = [0]
    for mag in range(28, min(iw // 2, 520), 28):
        dx_steps.extend([mag, -mag])

    # Prefer above element, then below; nudge vertically when the strip is crowded.
    for prefer_above in (True, False):
        base_y = (y1 - box_h - gap) if prefer_above else (y2 + gap)
        for extra_y in range(0, min(260, ih // 2), 10):
            y_cand = base_y - extra_y if prefer_above else base_y + extra_y
            for dx in dx_steps:
                bx = int(max(2, min(cx - box_w // 2 + dx, iw - box_w - 2)))
                if fits(bx, y_cand):
                    return bx, y_cand

    # Right-edge stack (common when many issues sit on one horizontal band)
    bx_stack = iw - box_w - 6
    sy = 10 + len(occupied) * (box_h + 10)
    if sy + box_h < ih - 6 and fits(bx_stack, sy):
        return bx_stack, sy

    bx_fb = int(max(2, min(cx - box_w // 2, iw - box_w - 2)))
    by_fb = int(max(2, min(y1 - box_h - gap, ih - box_h - 2)))
    return bx_fb, by_fb


def draw_exact_format(
    img,
    bbox,
    error_text,
    fix_text,
    issue_num: int | None = None,
    occupied_panels: list[tuple[int, int, int, int]] | None = None,
):
    """
    Draw violation frame + modern audit card (Pillow: rounded corners, blur shadow,
    system font) and an orthogonal connector so leaders tangle less than diagonals.

    Violation outline is drawn last so it reads above the connector.
    """
    if occupied_panels is None:
        occupied_panels = []

    try:
        bbox_list = list(bbox) if not isinstance(bbox, list) else bbox
        if len(bbox_list) != 4:
            print(f"⚠️ Invalid bbox: expected 4 elements, got {len(bbox_list)}: {bbox}")
            return
        x1, y1, x2, y2 = map(int, bbox_list)
    except (ValueError, TypeError) as e:
        print(f"⚠️ Error unpacking bbox: {e}, bbox={bbox}")
        return

    # BGR — error (red) + fix (green) double frame, still thick vs. app UI chrome
    BOX_OUTER_BGR = (52, 52, 235)    # error red
    BOX_INNER_BGR = (92, 205, 88)    # fix green
    try:
        ih, iw = img.shape[:2]
    except (ValueError, TypeError) as e:
        print(f"⚠️ Error getting image shape: {e}")
        return

    err_s = _overlay_shorten(error_text, 58) if error_text else ""
    fix_s = _overlay_shorten(fix_text, 50) if fix_text else ""
    if not err_s and not fix_s:
        cv2.rectangle(img, (x1, y1), (x2, y2), BOX_OUTER_BGR, 3)
        cv2.rectangle(img, (x1 + 3, y1 + 3), (x2 - 3, y2 - 3), BOX_INNER_BGR, 2)
        return

    font_row = _load_audit_ui_font(15)
    font_chip = _load_audit_ui_font(13)

    # RGB for Pillow — error copy in red; borders away from neutral UI chrome
    BG_FACE = (252, 252, 254)
    BG_ERR = (255, 242, 242)
    BG_FIX = (241, 252, 246)
    TXT_ERR = (200, 26, 36)
    TXT_FIX = (28, 112, 62)
    ACC_ERR = (210, 55, 65)
    ACC_FIX = (56, 168, 90)
    STROKE = (198, 92, 72)
    CHIP_BG = (48, 52, 78)
    CHIP_FG = (255, 255, 255)
    LEADER_CORE = (62, 98, 210)
    LEADER_HALO = (235, 238, 248)

    pad_x = 14
    row_pad_y = 10
    accent_w = 4
    card_radius = 14
    chip_text = str(issue_num) if issue_num is not None else ""

    err_line = f"ERR: {err_s}" if err_s else ""
    fix_line = f"FIX: {fix_s}" if fix_s else ""

    rows: list[tuple[str, str]] = []
    if err_line:
        rows.append(("err", err_line))
    if fix_line:
        rows.append(("fix", fix_line))

    chip_w, chip_h = (0, 0)
    chip_pill_w = 0
    if chip_text:
        chip_w, chip_h = _pil_text_size(font_chip, chip_text)
        chip_pill_w = chip_w + 18

    row_metrics: list[tuple[str, str, int, int]] = []
    for kind, txt in rows:
        tw, th = _pil_text_size(font_row, txt)
        extra = chip_pill_w + 8 if kind == "err" and chip_pill_w else 0
        row_metrics.append((kind, txt, tw + extra, th))

    inner_pad = accent_w + pad_x
    box_w = min(iw - 12, max(m[2] for m in row_metrics) + inner_pad * 2 + 16)
    row_heights = [m[3] + row_pad_y * 2 + 4 for m in row_metrics]
    box_h = sum(row_heights) + 12

    bx1, by_top = _find_callout_origin(iw, ih, x1, y1, x2, y2, box_w, box_h, occupied_panels)
    bx2 = bx1 + box_w
    y_bottom = by_top + box_h

    p_panel, p_bbox = _leader_anchor_points(
        x1, y1, x2, y2, bx1, by_top, bx2, y_bottom
    )
    poly = _orthogonal_polyline(p_panel, p_bbox)

    margin = 42
    xs = [x1, x2, bx1, bx2, p_bbox[0], p_panel[0]] + [p[0] for p in poly]
    ys = [y1, y2, by_top, y_bottom, p_bbox[1], p_panel[1]] + [p[1] for p in poly]
    rx1 = int(max(0, min(xs) - margin))
    ry1 = int(max(0, min(ys) - margin))
    rx2 = int(min(iw, max(xs) + margin))
    ry2 = int(min(ih, max(ys) + margin))
    if rx2 <= rx1 or ry2 <= ry1:
        return

    def loc(gx: int, gy: int) -> tuple[int, int]:
        return gx - rx1, gy - ry1

    roi_bgr = img[ry1:ry2, rx1:rx2].copy()
    base_rgba = Image.fromarray(cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)).convert("RGBA")
    layer = Image.new("RGBA", (rx2 - rx1, ry2 - ry1), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    cx1, cy1 = loc(bx1, by_top)
    cx2, cy2 = loc(bx2, y_bottom)
    cw, ch = cx2 - cx1, cy2 - cy1
    shadow_pad = 18
    sh = Image.new("RGBA", (cw + shadow_pad * 2, ch + shadow_pad * 2), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle(
        (shadow_pad, shadow_pad, cw + shadow_pad, ch + shadow_pad),
        radius=card_radius + 2,
        fill=(28, 32, 48, 95),
    )
    sh = sh.filter(ImageFilter.GaussianBlur(radius=9))
    layer.paste(sh, (cx1 - shadow_pad, cy1 - shadow_pad), sh)

    d.rounded_rectangle(
        (cx1, cy1, cx2, cy2),
        radius=card_radius,
        fill=(*BG_FACE, 255),
        outline=(*STROKE, 255),
        width=2,
    )

    y_cur = by_top
    for irow, ((kind, txt, _tw, th), row_h) in enumerate(zip(row_metrics, row_heights)):
        y0 = y_cur
        y1b = y_cur + row_h
        lx1, ly1 = loc(bx1, y0)
        lx2, ly2 = loc(bx2, y1b)
        bg = BG_ERR if kind == "err" else BG_FIX
        acc = ACC_ERR if kind == "err" else ACC_FIX
        txt_col = TXT_ERR if kind == "err" else TXT_FIX
        d.rounded_rectangle(
            (lx1 + 2, ly1 + 2, lx2 - 2, ly2 - 2),
            radius=max(6, card_radius - 4),
            fill=(*bg, 255),
        )
        ax1, ay1 = loc(bx1 + 3, y0 + 4)
        ax2, ay2 = loc(bx1 + 3 + accent_w, y1b - 4)
        d.rounded_rectangle((ax1, ay1, ax2, ay2), radius=3, fill=(*acc, 255))

        tx = bx1 + accent_w + pad_x
        if kind == "err" and chip_text:
            pill_x1 = tx
            pill_y1 = y0 + (row_h - chip_h - 14) // 2
            pill_x2 = pill_x1 + chip_pill_w
            pill_y2 = pill_y1 + chip_h + 12
            px1, py1 = loc(pill_x1, pill_y1)
            px2, py2 = loc(pill_x2, pill_y2)
            d.rounded_rectangle(
                (px1, py1, px2, py2),
                radius=8,
                fill=(*CHIP_BG, 255),
            )
            tw_ch, th_ch = _pil_text_size(font_chip, chip_text)
            d.text(
                (
                    px1 + (chip_pill_w - tw_ch) // 2,
                    py1 + max(0, (pill_y2 - pill_y1 - th_ch) // 2),
                ),
                chip_text,
                font=font_chip,
                fill=CHIP_FG,
            )
            tx = pill_x2 + 10

        _, th_txt = _pil_text_size(font_row, txt)
        ty_text = y0 + (row_h - th_txt) // 2
        tlx, tly = loc(tx, ty_text)
        d.text((tlx, tly), txt, font=font_row, fill=txt_col)
        y_cur = y1b

    pl = [loc(px, py) for px, py in poly]
    line_kwargs: dict = {"joint": "curve"}
    try:
        d.line(pl, fill=(*LEADER_HALO, 200), width=12, **line_kwargs)
    except TypeError:
        line_kwargs = {}
        d.line(pl, fill=(*LEADER_HALO, 200), width=12)
    try:
        d.line(pl, fill=(*LEADER_CORE, 255), width=5, **line_kwargs)
    except TypeError:
        d.line(pl, fill=(*LEADER_CORE, 255), width=5)

    bx, by = loc(p_bbox[0], p_bbox[1])
    d.ellipse((bx - 9, by - 9, bx + 9, by + 9), outline=(*LEADER_CORE, 255), width=3)
    d.ellipse((bx - 3, by - 3, bx + 3, by + 3), fill=(*LEADER_CORE, 255))

    out = Image.alpha_composite(base_rgba, layer)
    blended = cv2.cvtColor(np.array(out.convert("RGB")), cv2.COLOR_RGB2BGR)
    img[ry1:ry2, rx1:rx2] = blended

    cv2.rectangle(img, (x1, y1), (x2, y2), BOX_OUTER_BGR, 3)
    cv2.rectangle(img, (x1 + 3, y1 + 3), (x2 - 3, y2 - 3), BOX_INNER_BGR, 2)

    occupied_panels.append((bx1, by_top, bx2, y_bottom))

def _call_gemini(prompt: str, img_path: str) -> str:
    """Single Gemini call with global throttle + retry on transient 503s."""
    img = PIL.Image.open(img_path)
    last_exc: Exception | None = None
    for attempt in range(GEMINI_MAX_RETRIES + 1):
        _throttle_gemini()
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[prompt, img],
            )
            return response.text.strip()
        except Exception as e:
            last_exc = e
            if attempt < GEMINI_MAX_RETRIES and _is_transient_gemini_error(e):
                delay = GEMINI_RETRY_BASE_DELAY * (2 ** attempt)
                print(f"⚠️ Gemini transient error (attempt {attempt + 1}): {e} — retrying in {delay:.1f}s")
                time.sleep(delay)
                continue
            break
    raise last_exc if last_exc else RuntimeError("Gemini call failed with no exception")


def ask_gemini(prompt, img_path):
    """Short-answer Gemini call. Returns a safe fallback if Gemini is overloaded."""
    try:
        text = _call_gemini(prompt, img_path)
        return text.replace('"', '').replace("'", "")[:40]
    except Exception as e:
        print(f"⚠️ Gemini Error: {e}")
        return "Optimize Design"


def get_full_response(prompt, img_path):
    try:
        return _call_gemini(prompt, img_path)
    except Exception as e:
        print(f"⚠️ Gemini Error (full): {e}")
        return "Modern UI Interface"

# --- MAIN SERVICE PIPELINE ---

def run_feedback_pipeline(ui_image_path: str, json_file_path: str, yolo_model_path: str = "yolov8n.pt", analysis_type: str = "all"):
    """
    Runs the multi-phase UI audit and saves annotated images.
    Returns the paths to the generated images and the final prompt.
    """
    processed_bboxes = [] 
    collected_issues = []  

    try:
        model = YOLO(yolo_model_path)
    except:
        model = YOLO("yolov8n.pt")

    img_raw = cv2.imread(ui_image_path)
    if img_raw is None:
        return {"error": f"Image {ui_image_path} not found"}

    img_p1, img_p2, img_p3 = img_raw.copy(), img_raw.copy(), img_raw.copy()
    # Track callout panel rectangles per output image so labels never stack on top
    # of each other (common with several violations along one row, e.g. kanban dates).
    callout_rects_p1: list[tuple[int, int, int, int]] = []
    callout_rects_p2: list[tuple[int, int, int, int]] = []
    callout_rects_p3: list[tuple[int, int, int, int]] = []

    def is_duplicate(new_box, threshold=40):
        for box in processed_bboxes:
            if all(abs(new_box[i] - box[i]) < threshold for i in range(4)):
                return True
        return False

    # --- PHASE 1: ANNOTATION FROM AUDIT JSON ---
    # Always run when audit JSON exists — draws bounding boxes on FAIL elements
    # regardless of analysis_type (rules, elements, or all).
    # The frontend controls what's in the JSON based on the user's option choice.
    has_phase1_annotations = False
    tasks: list[dict] = []
    if os.path.exists(json_file_path):
        with open(json_file_path, 'r') as f:
            data = json.load(f)
            elements = data.get('elements', [])
            failures = [el for el in elements if el.get('status') == 'FAIL']

        # Split by source. Phase 1 annotates every FAIL with a bbox (no fixed cap);
        # each item still triggers one Gemini call for the FIX line.
        comp1_failures = [v for v in failures
                          if v.get('source') == 'comp1_ai_audit' and 'bbox' in v]
        comp2_failures = [v for v in failures
                          if v.get('source') == 'comp2_element_audit' and 'bbox' in v]
        other_failures = [v for v in failures
                          if v.get('source') not in ('comp1_ai_audit', 'comp2_element_audit')
                          and 'bbox' in v]

        comp2_failures.sort(key=lambda v: v.get('similarity_score', 100))

        if analysis_type == 'rules':
            picked_comp1, picked_comp2 = list(comp1_failures), []
        elif analysis_type == 'elements':
            picked_comp1, picked_comp2 = [], list(comp2_failures)
        else:
            picked_comp1, picked_comp2 = list(comp1_failures), list(comp2_failures)

        selected_failures = picked_comp1 + picked_comp2 + list(other_failures)
        print(
            f"[feedback] Phase 1 selection: {len(picked_comp1)} rule violation(s), "
            f"{len(picked_comp2)} low-similarity component(s), "
            f"{len(other_failures)} other FAIL(s) "
            f"(totals in JSON: {len(comp1_failures)} / {len(comp2_failures)} / other)"
        )

        # Build one Gemini task per failure, then run them concurrently.
        tasks = []
        for v in selected_failures:
            if 'bbox' not in v:
                continue
            bbox = v['bbox']
            source = v.get('source', '')

            # short_label: used on the annotated image (tight, ≤ ~40 chars)
            # full_desc:   used in the Gemini prompt (full context)
            try:
                short_label, full_desc = _extract_issue_context(v)
            except (ValueError, TypeError) as e:
                print(f"⚠️ Error extracting issue context: {e}")
                short_label = "UI Violation"
                full_desc = "UI element flagged by audit"

            # An element may fail multiple rules at once (full_desc can span
            # several lines). The prompt treats single/multi-rule uniformly.
            multi_rule = full_desc.lower().startswith("2 rule") or "\n- " in full_desc
            rules_word = "rules" if multi_rule else "rule"

            if source == 'comp2_element_audit':
                prompt = (
                    f"You are a senior UI designer. A UI element has this specific issue:\n"
                    f"{full_desc}\n"
                    f"Suggest ONE concrete visual improvement in EXACTLY 3 words. "
                    f"Format: 'Word Word Word'. No punctuation, no quotes, no extra words."
                )
            else:
                prompt = (
                    f"You are a senior UI designer. A UI element violates the following {rules_word}:\n"
                    f"{full_desc}\n"
                    f"Suggest the single most-important fix that addresses the most critical "
                    f"violation above, in EXACTLY 3 words. "
                    f"If a rule is about button/touch-target height, suggest a height/size fix. "
                    f"If it's about contrast, suggest a contrast/color fix. "
                    f"If it's about font size, suggest a typography fix. "
                    f"Stay on-topic — never suggest unrelated UX advice. "
                    f"Format: 'Word Word Word'. No punctuation, no quotes, no extra words."
                )

            tasks.append({
                "bbox": bbox,
                "short_label": short_label,
                "full_desc": full_desc,
                "prompt": prompt,
            })

        if tasks:
            has_phase1_annotations = True
            with ThreadPoolExecutor(max_workers=GEMINI_PARALLEL_WORKERS) as pool:
                fix_by_idx: dict[int, str] = {}
                future_to_idx = {
                    pool.submit(ask_gemini, t["prompt"], ui_image_path): i
                    for i, t in enumerate(tasks)
                }
                for fut in as_completed(future_to_idx):
                    idx = future_to_idx[fut]
                    try:
                        fix_by_idx[idx] = fut.result()
                    except Exception as e:
                        print(f"⚠️ Gemini parallel error: {e}")
                        fix_by_idx[idx] = "Optimize Design"

            # Apply results in original order so annotations stay deterministic
            for i, t in enumerate(tasks):
                fix_short = fix_by_idx.get(i, "Optimize Design")
                collected_issues.append(f"- Fix: '{t['full_desc']}' → '{fix_short}'")
                num = i + 1
                draw_exact_format(
                    img_p1,
                    t["bbox"],
                    t["short_label"],
                    fix_short,
                    issue_num=num,
                    occupied_panels=callout_rects_p1,
                )
                draw_exact_format(
                    img_p3,
                    t["bbox"],
                    t["short_label"],
                    fix_short,
                    issue_num=num,
                    occupied_panels=callout_rects_p3,
                )
                processed_bboxes.append(t["bbox"])
            
    # --- PHASE 2: AESTHETIC / ELEMENT-SIMILARITY ---
    # Prefer real comp2 low-similarity components from the audit JSON (they
    # carry actual similarity_score + matched_expert data). Fall back to a
    # fresh YOLO pass only if the JSON has no comp2 data at all.
    temp_annotated = ""
    if analysis_type in ['elements', 'all']:
        comp2_for_phase2: list[dict] = []
        if os.path.exists(json_file_path):
            try:
                with open(json_file_path, 'r') as f:
                    _data = json.load(f)
                comp2_for_phase2 = [
                    el for el in _data.get('elements', [])
                    if el.get('source') == 'comp2_element_audit'
                    and el.get('status') == 'FAIL'
                    and 'bbox' in el
                ]
                # Annotate the worst-scoring components first
                comp2_for_phase2.sort(key=lambda v: v.get('similarity_score', 100))
            except Exception as e:
                print(f"[feedback] Could not re-read audit JSON for Phase 2: {e}")

        phase2_tasks: list[dict] = []
        # In 'all' mode, Phase 1 already drew every comp2 FAIL — skip re-querying Gemini
        # and re-drawing the same bboxes (would stack duplicate callouts on phase 3).
        phase2_skip_json_duplicate = bool(
            analysis_type == 'all' and comp2_for_phase2
        )
        if phase2_skip_json_duplicate and has_phase1_annotations:
            img_p2 = img_p1.copy()
        elif comp2_for_phase2:
            for v in comp2_for_phase2:
                try:
                    short_label, full_desc = _extract_issue_context(v)
                except (ValueError, TypeError) as e:
                    print(f"⚠️ Error extracting comp2 issue context: {e}")
                    short_label = "Similarity Mismatch"
                    full_desc = "Element has low similarity to expert patterns"
                prompt = (
                    f"You are a senior UI designer. {full_desc}\n"
                    f"Suggest ONE concrete style, spacing, or visual fix in EXACTLY 3 words. "
                    f"Format: 'Word Word Word'. No punctuation, no quotes, no extra words."
                )
                phase2_tasks.append({
                    "bbox": v["bbox"],
                    "short_label": short_label,
                    "prompt": prompt,
                    "prompt_img": ui_image_path,
                })
        else:
            # Fallback: no JSON / no comp2 data. Run YOLO and label a few boxes.
            results = model(ui_image_path)
            temp_annotated = os.path.join(UPLOAD_DIR, f"temp_annotated_{uuid.uuid4().hex[:8]}.jpg")
            cv2.imwrite(temp_annotated, results[0].plot())

            for box in results[0].boxes.xyxy.cpu().numpy():
                if len(phase2_tasks) >= 3:
                    break
                if is_duplicate(box):
                    continue
                phase2_tasks.append({
                    "bbox": box,
                    "short_label": "Similarity Mismatch",
                    "prompt": (
                        "EXACTLY 3 words ONLY. Suggest one style/spacing fix for this UI "
                        "element. Answer format: 'Word Word Word'. NO extra words, NO "
                        "punctuation. THREE WORDS ONLY."
                    ),
                    "prompt_img": temp_annotated,
                })

        if phase2_tasks:
            with ThreadPoolExecutor(
                max_workers=min(GEMINI_PARALLEL_WORKERS, len(phase2_tasks))
            ) as pool:
                fix_by_idx: dict[int, str] = {}
                future_to_idx = {
                    pool.submit(ask_gemini, t["prompt"], t["prompt_img"]): i
                    for i, t in enumerate(phase2_tasks)
                }
                for fut in as_completed(future_to_idx):
                    idx = future_to_idx[fut]
                    try:
                        fix_by_idx[idx] = fut.result()
                    except Exception as e:
                        print(f"⚠️ Gemini parallel error (aesthetic): {e}")
                        fix_by_idx[idx] = "Optimize Design"

            phase1_count = len(tasks) if tasks else 0
            for i, t in enumerate(phase2_tasks):
                fix_short = fix_by_idx.get(i, "Optimize Design")
                collected_issues.append(f"- {t['short_label']}: {fix_short}")
                p2_num = i + 1
                p3_num = phase1_count + i + 1
                draw_exact_format(
                    img_p2,
                    t["bbox"],
                    t["short_label"],
                    fix_short,
                    issue_num=p2_num,
                    occupied_panels=callout_rects_p2,
                )
                draw_exact_format(
                    img_p3,
                    t["bbox"],
                    t["short_label"],
                    fix_short,
                    issue_num=p3_num,
                    occupied_panels=callout_rects_p3,
                )
                processed_bboxes.append(t["bbox"])

    # --- PHASE 3: SYNTHESIS (text only; do not paint on img_p3) ---
    # A solid top banner was drawn here previously; it covered the first ~60px of
    # the canvas and erased rule-based callouts (e.g. URL/contrast) that Phase 1
    # had already drawn. The app shows synthesis_message in AnnotatedResultView;
    # the combined image should keep all ERR/FIX overlays visible.
    synthesis_msg = ""
    if analysis_type == 'all':
        final_prompt = "EXACTLY 4 words ONLY. What is the top UX priority? Answer format: 'Word Word Word Word'. NO extra words, NO punctuation. FOUR WORDS ONLY."
        synthesis_msg = ask_gemini(final_prompt, temp_annotated if temp_annotated else ui_image_path)

    # Clean up temp file
    if temp_annotated and os.path.exists(temp_annotated):
        os.remove(temp_annotated)

    # Save outputs with unique IDs
    req_id = uuid.uuid4().hex[:8]
    images = {}

    # Always save Phase 1 if we drew any annotations from audit JSON
    if has_phase1_annotations:
        out1_path = os.path.join(UPLOAD_DIR, f"{req_id}_p1.jpg")
        cv2.imwrite(out1_path, img_p1)
        images["phase1_technical"] = f"/feedback/report/{req_id}_p1"

    if analysis_type in ['elements', 'all']:
        out2_path = os.path.join(UPLOAD_DIR, f"{req_id}_p2.jpg")
        cv2.imwrite(out2_path, img_p2)
        images["phase2_aesthetic"] = f"/feedback/report/{req_id}_p2"

    if analysis_type == 'all':
        out3_path = os.path.join(UPLOAD_DIR, f"{req_id}_p3.jpg")
        cv2.imwrite(out3_path, img_p3)
        images["phase3_synthesis"] = f"/feedback/report/{req_id}_p3"

    # --- PHASE 4: PROMPT GENERATION ---
    # Always build a redesign prompt so the "Preview Enhanced UI" button works
    # for every analysis_type (rules, elements, all). The prompt framing
    # changes based on what was actually analyzed so it stays on-topic.
    focus_map = {
        'rules': (
            "rule-compliance violations (touch-target size, contrast ratios, "
            "font sizes, spacing, etc.)"
        ),
        'elements': (
            "low-similarity elements that diverge from production-grade "
            "expert patterns (style, proportions, polish)"
        ),
        'all': (
            "both rule-compliance violations AND low-similarity elements that "
            "diverge from production-grade expert patterns"
        ),
    }
    focus_area = focus_map.get(analysis_type, focus_map['all'])
    issues_text = "\n".join(collected_issues) if collected_issues else "- (no automated issues captured)"
    synthesis_line = (
        f"The top UX priority is: {synthesis_msg}\n" if synthesis_msg else ""
    )

    prompt_req = f"""You are a senior UI/UX designer and creative director. Analyze the attached UI screenshot carefully.

This interface was audited and the focus area is: {focus_area}.

Specific issues found by automated auditing:
{issues_text}

{synthesis_line}Your task: Write a detailed, creative prompt that will be sent to Gemini's image generation model along with this screenshot to produce a REDESIGNED, ENHANCED version of this exact UI.

The prompt MUST instruct the model to:

1. **Preserve the core layout and purpose** — keep the same screen type (login, dashboard, form, etc.) and same content structure, but elevate every visual aspect.

2. **Fix all identified issues** — directly address each flaw listed above with specific design corrections (e.g., if contrast is low, specify high-contrast text on appropriate backgrounds; if touch targets are small, enlarge buttons to at least 44px; if similarity is low, align the component to expert-grade patterns).

3. **Apply modern design principles**:
   - Clean visual hierarchy with clear spacing (8px grid system)
   - Consistent border-radius (rounded corners on cards, buttons, inputs)
   - Subtle depth via soft shadows (no harsh drop shadows)
   - Ample white space / breathing room between sections
   - Professional color palette: a primary accent color, neutral backgrounds, and clear contrast ratios (WCAG AA minimum)

4. **Typography excellence**:
   - Clear font size hierarchy (headings visually distinct from body)
   - Proper line height and letter spacing
   - No more than 2 font weights visible

5. **Creative polish**:
   - Subtle gradient accents or glassmorphism where appropriate
   - Micro-interaction hints (hover states, focus rings implied in static design)
   - Icon consistency (uniform stroke weight and style)
   - Professional empty states and placeholder content
   - A cohesive, modern aesthetic — think Stripe, Linear, or Vercel quality

6. **Accessibility**: Ensure text is readable, interactive elements are clearly distinguishable, and color is not the only indicator of state.

IMPORTANT: The output should look like a REAL, polished production UI — not an abstract art piece. It must be immediately usable and professional.

Return ONLY the prompt string, nothing else. Make it detailed and specific to this UI."""

    final_prompt_text = get_full_response(prompt_req, ui_image_path)

    return {
        "status": "success",
        "images": images,
        "synthesis_message": synthesis_msg,
        "generator_prompt": final_prompt_text
    }

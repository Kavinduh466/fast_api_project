"""
auditor_service.py  –  SMARTUI_RL Main Audit Pipeline
======================================================

Pipeline stages:
  1. YOLO element detection
  2. Per-element deep inspection  (OCR + contrast via audit_utils)
  3. Metric rule checks           (pixel thresholds from RuleEngine)
  4. Violet / text rule evaluation (LLM judges each Excel rule)
  5. LLM general analysis         (summary paragraph)
  6. RL gate                       (FeedbackLearner.should_flag_violation)

The RL gate is applied BEFORE adding a violation to the output, so
violations the designer has repeatedly dismissed are suppressed.
"""

import os
import cv2
import torch
import numpy as np

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
cv2.setNumThreads(0)
torch.set_num_threads(1)

from ultralytics import YOLO, settings
from ctransformers import AutoModelForCausalLM

from SMARTUI_RL.rule_engine  import RuleEngine
from SMARTUI_RL.audit_utils  import (analyze_element_content,
                                     compute_layout_metrics,
                                     build_elements_summary,
                                     _get_reader)
from SMARTUI_RL.rl_feedback  import FeedbackLearner

try:
    settings.update({"sync": False, "uuid": "0", "api_key": ""})
except Exception as e:
    print(f"[auditor] ⚠️  Ultralytics settings: {e}")

# ── Singleton model registry ───────────────────────────────────────────────────
_models: dict = {"vision": None, "llm": None, "engine": None, "rl": None}

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(BASE_DIR, "ui_model.pt")
LLM_PATH    = os.path.join(BASE_DIR, "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf")
EXCEL_PATH  = os.path.join(BASE_DIR, "UI_RULE_SETS.xlsx")


def _get_vision():
    if _models["vision"] is None:
        print(f"[auditor] 📥 Loading YOLO: {MODEL_PATH}")
        _models["vision"] = YOLO(MODEL_PATH)
    return _models["vision"]


def _get_llm():
    if _models["llm"] is None:
        print(f"[auditor] 📥 Loading TinyLlama: {LLM_PATH}")
        _models["llm"] = AutoModelForCausalLM.from_pretrained(
            "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
            model_file=LLM_PATH,
            model_type="llama",
            threads=1,
            gpu_layers=0,
            context_length=2048,
        )
    return _models["llm"]


def _get_engine():
    if _models["engine"] is None:
        _models["engine"] = RuleEngine(excel_file=EXCEL_PATH)
    return _models["engine"]


def _get_rl():
    if _models["rl"] is None:
        _models["rl"] = FeedbackLearner(
            memory_file=os.path.join(BASE_DIR, "rl_memory.json")
        )
    return _models["rl"]


# Public alias used by server routers (feedback.py, etc.)
def get_rl() -> FeedbackLearner:
    return _get_rl()


def get_engine() -> RuleEngine:
    return _get_engine()


def get_llm():
    return _get_llm()


# ── Metric rule checks ─────────────────────────────────────────────────────────

def _get_element_value(metric_key: str, element: dict, content: dict):
    """
    Read the measurement defined by metric_key directly from element data.
    metric_key comes from Excel column E — no hardcoding here.
    """
    x1, y1, x2, y2 = element["bbox"]
    height = y2 - y1
    width  = x2 - x1
    if metric_key == "height":
        return float(height)
    if metric_key == "width":
        return float(width)
    if metric_key == "contrast":
        return content.get("contrast")      # float from K-Means/WCAG
    if metric_key == "font_size":
        return float(height) / 1.3          # rough estimate from bbox height
    return None


def _check_metric_rules(element: dict, engine: RuleEngine, rl: FeedbackLearner,
                         profile: str) -> list[dict]:
    """
    Check one element against every measurable rule loaded from Excel.

    Everything — which rules apply, what to measure, the threshold, element
    types, comparator — comes from engine.measurable_rules which was read
    from Excel columns E-H. Nothing is hardcoded in this function.
    """
    violations = []
    content  = element.get("content", {})
    text     = (content.get("text") or "Unknown")[:60]
    cls_name = element["type"].lower()
    is_icon  = content.get("is_icon", False)

    for rule in engine.measurable_rules:
        rule_id    = rule["rule_id"]
        rule_name  = rule["name"]
        metric_key = rule["metric_key"]          # from Excel col E
        threshold  = rule["metric_value"]        # from Excel col F (float)
        elem_types = rule["element_types"]       # from Excel col G (list)
        comparator = rule["comparator"]          # from Excel col H

        if threshold is None:
            continue

        # 1. Element type filter — empty list means "applies to all"
        if elem_types:
            if not any(t in cls_name for t in elem_types):
                continue

        # 2. Skip icons for contrast/font checks
        if metric_key in ("contrast", "font_size") and is_icon:
            continue

        # 3. Measure the element
        val = _get_element_value(metric_key, element, content)
        if val is None:
            continue

        # 4. Evaluate
        violated = (val < threshold) if comparator == "lt" else (val > threshold)
        if not violated:
            continue

        # 5. Human-readable description
        if metric_key == "contrast":
            desc = (f"'{text}' ({cls_name}) contrast {val:.2f}:1 "
                    f"— need ≥{threshold:.1f}:1 per {rule_id}.")
        else:
            unit = "px" if metric_key in ("height", "width") else "pt"
            desc = (f"'{text}' ({cls_name}) {metric_key} {val:.0f}{unit} "
                    f"— {rule_id} requires ≥{threshold:.0f}{unit}.")

        # 6. RL gate
        if rl.should_flag_violation(profile, rule_id):
            violations.append({
                "rule_id":     rule_id,
                "rule_name":   rule_name,
                "description": desc,
                "source":      "metric",
                "violated":    True,
                "element_id":  element["id"],
            })
            print(f"   [metric] ❌ {rule_id} – {desc[:70]}")
        else:
            print(f"   [metric] 🛡️  {rule_id} suppressed by RL policy")

    return violations


# ── Violet / text rule LLM evaluation ─────────────────────────────────────────

def _evaluate_text_rules(llm, engine: RuleEngine, rl: FeedbackLearner,
                          profile: str, context: str) -> list[dict]:
    """
    Ask TinyLlama to judge each text-based rule from the Excel sheet.
    Returns list of {rule_id, rule_name, description, violated, source} dicts.
    Only rules that pass the RL gate are evaluated (saves inference time).
    """
    results = []

    if llm is None:
        print("[auditor] ⚠️  LLM unavailable – skipping text rule evaluation")
        return results

    # Limit to 8 rules max for speed — TinyLlama is slow on CPU
    rules = engine.get_rules_for_llm(max_rules=4)
    print(f"[auditor] 🟣 Evaluating {len(rules)} text rules with TinyLlama...")

    for rule in rules:
        rule_id   = rule["rule_id"]
        rule_name = rule["name"]
        rule_desc = rule["description"][:120]   # trim description for faster inference

        # RL gate: skip rules agent is confident about suppressing
        if not rl.should_flag_violation(profile, rule_id):
            print(f"   [llm] 🛡️  {rule_id} ({rule_name}) suppressed by RL")
            results.append({
                "rule_id":     rule_id,
                "rule_name":   rule_name,
                "description": "Suppressed by RL policy (designer previously dismissed).",
                "violated":    False,
                "source":      "rl_suppressed",
            })
            continue

        # Shorter prompt = faster inference on TinyLlama 1.1B CPU
        prompt = (
            f"[INST] UI auditor. Profile: {profile}.\n"
            f"Elements: {context[:300]}\n"
            f"Rule [{rule_id}]: {rule_desc}\n"
            f"Violated? Reply STATUS: VIOLATED or STATUS: PASSED only.\n[/INST]"
        )

        try:
            raw   = llm(prompt, max_new_tokens=32, temperature=0.1)
            lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]

            violated = any("VIOLATED" in l.upper() for l in lines[:3])
            reason   = rule_desc  # fallback

            for line in lines:
                if "REASON:" in line.upper():
                    candidate = line.split(":", 1)[-1].strip()
                    if len(candidate) > 8:
                        reason = candidate
                    break

            icon = "❌" if violated else "✅"
            print(f"   [llm] {icon} {rule_id} – {rule_name}")

            results.append({
                "rule_id":     rule_id,
                "rule_name":   rule_name,
                "description": reason,
                "violated":    violated,
                "source":      "llm",
            })

        except Exception as exc:
            print(f"   [llm] ⚠️  Error on {rule_id}: {exc}")

    n_violated = sum(1 for r in results if r["violated"])
    print(f"[auditor] 🟣 Text rule evaluation done: {n_violated}/{len(results)} violated")
    return results


# ── LLM general analysis ───────────────────────────────────────────────────────

def _llm_general_analysis(llm, profile: str, metric_violations: list[str],
                           text_violations: list[str]) -> str:
    if llm is None:
        return "LLM analysis not available."

    all_v  = (metric_violations + text_violations)[:5]
    prompt = (
        f"[INST] You are a senior UX consultant.\n"
        f"Profile: {profile.upper()}\n"
        f"Top violations found: {all_v if all_v else 'none'}\n"
        f"Write 2 concise sentences: (1) why these matter for {profile} users, "
        f"(2) the single most important fix.\n[/INST]"
    )
    try:
        return llm(prompt, max_new_tokens=120, temperature=0.5).strip()
    except Exception as exc:
        return f"LLM error: {exc}"


# ── Main entry point ───────────────────────────────────────────────────────────

def run_smart_audit(image_path: str, profile: str = "universal") -> dict:
    """
    Full SMARTUI_RL audit pipeline.

    Returns a report dict consumed by the frontend:
    {
      "meta":        {profile, timestamp}
      "summary":     {score, violations, metric_violations, text_violations}
      "violations":  [unified list – both metric & text]
      "elements":    [per-element detail]
      "llm_analysis": str
    }
    """
    engine = _get_engine()
    vision = _get_vision()
    rl     = _get_rl()

    if vision is None:
        return {"error": "Vision model could not be initialised"}

    # ── Load profile rules from Excel ──────────────────────────────────────
    engine.load_rules(profile)

    # ── YOLO detection ─────────────────────────────────────────────────────
    if not os.path.exists(image_path):
        return {"error": f"Image not found: {image_path}"}

    print(f"[auditor] 👁️  Running YOLO on: {image_path}")
    try:
        results  = vision(image_path, conf=0.15, verbose=False, device="cpu")
        num_det  = len(results[0].boxes) if results else 0
        print(f"[auditor] ✅ YOLO found {num_det} elements")
    except Exception as exc:
        return {"error": f"YOLO inference failed: {exc}"}

    if not results or num_det == 0:
        return {
            "meta":      {"profile": profile, "timestamp": str(np.datetime64("now"))},
            "summary":   {"score": 100, "violations": 0,
                          "metric_violations": 0, "text_violations": 0},
            "violations": [],
            "elements":  [],
            "llm_analysis": "No UI elements detected.",
        }

    orig_img = cv2.imread(image_path)
    if orig_img is None:
        return {"error": f"Could not read image: {image_path}"}

    img_h, img_w = orig_img.shape[:2]
    boxes   = results[0].boxes.xyxy.cpu().numpy()
    classes = results[0].boxes.cls.cpu().numpy()

    # ── Per-element analysis + metric checks ───────────────────────────────
    elements:          list[dict] = []
    metric_violations: list[dict] = []
    metric_viol_descs: list[str]  = []

    for i, box in enumerate(boxes):
        cls_id     = int(classes[i])
        cls_name   = vision.names[cls_id].lower()
        x1, y1, x2, y2 = map(int, box)

        # Deep inspection
        crop    = orig_img[max(0, y1):min(img_h, y2), max(0, x1):min(img_w, x2)]
        content = analyze_element_content(crop) if crop.size > 0 else {}

        element = {
            "id":      i,
            "type":    cls_name,
            "cls_id":  cls_id,
            "bbox":    [x1, y1, x2, y2],
            "content": content,
            "issues":  [],
            "status":  "PASS",
        }

        # Metric rule violations for this element
        viols = _check_metric_rules(element, engine, rl, profile)
        if viols:
            element["issues"]  = viols
            element["status"]  = "FAIL"
            metric_violations.extend(viols)
            metric_viol_descs.extend(v["description"] for v in viols)

        elements.append(element)
        print(f"   [{i+1}/{len(boxes)}] {cls_name} → {element['status']}")

    # ── Layout metrics ─────────────────────────────────────────────────────
    layout = compute_layout_metrics(elements, img_w, img_h)

    # ── Build context string for LLM ───────────────────────────────────────
    el_summary = build_elements_summary(elements)
    context = (
        f"AUDIT PROFILE: {profile.upper()}\n"
        f"IMAGE SIZE: {img_w}×{img_h}px\n"
        f"ELEMENTS FOUND: {len(elements)}\n"
        f"METRIC VIOLATIONS: {len(metric_violations)}\n"
        f"LAYOUT: alignment={layout['alignment_score']}, "
        f"whitespace={layout['whitespace_ratio']}, density={layout['density']}\n\n"
        f"{el_summary}"
    )

    # ── Text rule evaluation via LLM ───────────────────────────────────────
    llm          = _get_llm()
    text_results = _evaluate_text_rules(llm, engine, rl, profile, context)
    text_viols   = [r for r in text_results if r["violated"]]

    # ── LLM general analysis ───────────────────────────────────────────────
    llm_analysis = _llm_general_analysis(
        llm, profile,
        metric_viol_descs[:3],
        [v["rule_name"] for v in text_viols[:3]],
    )

    # ── Build unified violations list for the frontend ─────────────────────
    unified: list[dict] = []

    # 1. Metric violations (per element, deduplicated by rule_id+element_id)
    for v in metric_violations:
        unified.append({
            "rule_id":     v["rule_id"],
            "rule_name":   v["rule_name"],
            "description": v["description"],
            "violated":    True,
            "source":      "metric",
            "element_id":  v.get("element_id"),
        })

    # 2. Text violations (LLM-evaluated)
    for v in text_results:
        unified.append({
            "rule_id":     v["rule_id"],
            "rule_name":   v["rule_name"],
            "description": v["description"],
            "violated":    v["violated"],
            "source":      v["source"],
            "element_id":  None,
        })

    # ── Score ──────────────────────────────────────────────────────────────
    n_metric = len(metric_violations)
    n_text   = len(text_viols)
    n_total  = n_metric + n_text
    score    = max(0, 100 - n_total * 10)

    print(f"\n[auditor] ── Final Report ──────────────────────")
    print(f"  Profile   : {profile}")
    print(f"  Elements  : {len(elements)}")
    print(f"  Metric V. : {n_metric}")
    print(f"  Text V.   : {n_text}")
    print(f"  Score     : {score}")

    return {
        "meta": {
            "profile":   profile,
            "timestamp": str(np.datetime64("now")),
            "image_w":   img_w,
            "image_h":   img_h,
        },
        "summary": {
            "score":              score,
            "violations":         n_total,
            "metric_violations":  n_metric,
            "text_violations":    n_text,
        },
        "layout":       layout,
        "violations":   unified,
        "elements":     elements,
        "llm_analysis": llm_analysis,
    }
"""
UI Accessibility Audit Engine — Q-Learning Edition
====================================================
Pipeline:
  1. YOLO       → detect UI elements (bounding boxes)
  2. EasyOCR    → read text inside each element
  3. KMeans     → extract dominant colors (bg + fg)
  4. WCAG 2.1   → calculate contrast ratio
  5. RuleEngine → load thresholds per profile from Excel
  6. Q-Learning → decide whether to ask user (trained model)
  7. Human y/n  → update Q-table via Bellman equation
  8. Metrics    → track accuracy improvement across runs
"""

import json
import datetime
import cv2
import numpy as np

from rl_model      import QLearningAgent
from rule_engine   import RuleEngine
from audit_utils   import analyze_element, check_touch_target, check_contrast
from audit_metrics import AuditMetrics

# ── GLOBALS ──────────────────────────────────────────────────────────────────
engine  = RuleEngine("UI_RULE_SETS.xlsx")
agent   = QLearningAgent(
    model_file      = "rl_qtable.pkl",
    memory_file     = "rl_memory.json",
    learning_rate   = 0.1,
    discount_factor = 0.9,
    epsilon         = 0.3,
    epsilon_min     = 0.05,
    epsilon_decay   = 0.995,
)
metrics = AuditMetrics("metrics_history.json")

_vision_model = None

def get_vision_model():
    global _vision_model
    if _vision_model is None:
        from ultralytics import YOLO
        _vision_model = YOLO("yolov8n.pt")
        print("   ✅ YOLO model loaded.")
    return _vision_model


# ── RL INTERACTION ────────────────────────────────────────────────────────────

def _ask_and_update(profile, rule_name, violation, element_data, element_record, audit_report):
    agent.register_rule(profile, rule_name)

    features = {
        "width"   : element_record["size"]["width"],
        "height"  : element_record["size"]["height"],
        "contrast": element_data.get("contrast"),
        "is_icon" : element_data.get("is_icon", False),
    }

    should_flag, reason = agent.should_flag(profile, rule_name, features)

    if not should_flag:
        element_record["status"] = "SILENCED_BY_RL"
        print(f"   ⚫ SILENCED [{rule_name}] ({reason})")
        return

    print(f"\n   ⚠️  VIOLATION [{rule_name}]")
    print(f"      {violation['desc']}")
    print(f"      Weight: {agent.get_weight(profile, rule_name):.2f} | Q-decision: {reason}")

    while True:
        answer = input("      Flag this? (y/n): ").lower().strip()
        if answer in ('y', 'n'):
            break
        print("      Please enter y or n")

    user_feedback = +1 if answer == 'y' else -1

    # UPDATE Q-TABLE
    agent.update(profile, rule_name, features, action_taken=1, user_feedback=user_feedback)

    if answer == 'y':
        element_record["status"] = "FAIL"
        element_record["issues"].append(violation)
        audit_report["summary"]["violations"] += 1
        audit_report["summary"]["score"] -= 5
        print(f"   ✅ Flagged. Accuracy: {agent.get_accuracy():.1f}%")
    else:
        element_record["status"] = "IGNORED_BY_USER"
        print(f"   ❌ False positive. Accuracy: {agent.get_accuracy():.1f}%")


# ── MAIN AUDIT ────────────────────────────────────────────────────────────────

def run_audit(image_path, profile="universal", output_file="audit_result.json", show_weights=False):
    print(f"\n{'='*60}")
    print(f"  🚀 UI AUDIT — profile: {profile.upper()}")
    print(f"  🧠 Q-Model: {len(agent.q_table)} states learned | "
          f"accuracy: {agent.get_accuracy():.1f}% | ε={agent.epsilon:.3f}")
    print(f"{'='*60}")

    engine.load(profile)
    min_touch    = engine.get_threshold("min_touch_target")
    min_contrast = engine.get_threshold("min_contrast")

    if show_weights:
        agent.print_all_weights()

    print(f"\n   🔍 Scanning: {image_path}")
    vision   = get_vision_model()
    results  = vision(image_path, conf=0.15, verbose=False)
    original = cv2.imread(image_path)

    if original is None:
        print(f"   ❌ Cannot read image: {image_path}")
        return None

    boxes = results[0].boxes.xyxy.cpu().numpy()
    print(f"   📦 Detected {len(boxes)} elements")

    audit_report = {
        "meta": {
            "timestamp"  : str(datetime.datetime.now()),
            "profile"    : profile,
            "image"      : image_path,
            "model_state": {
                "q_states"    : len(agent.q_table),
                "interactions": agent.total_interactions,
                "accuracy"    : agent.get_accuracy(),
                "epsilon"     : round(agent.epsilon, 4),
            },
            "thresholds": {"min_touch": min_touch, "min_contrast": min_contrast}
        },
        "summary" : {"score": 100, "violations": 0, "total_elements": len(boxes)},
        "elements": []
    }

    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = map(int, box)
        h, w = y2 - y1, x2 - x1

        crop = original[max(0,y1):min(original.shape[0],y2),
                        max(0,x1):min(original.shape[1],x2)]
        data = analyze_element(crop)

        element_record = {
            "id"     : i,
            "bbox"   : [x1, y1, x2, y2],
            "size"   : {"width": w, "height": h},
            "content": data,
            "issues" : [],
            "status" : "PASS"
        }

        label = f"'{data['text']}'" if data.get("text") else "icon"
        print(f"\n   [{i}] {w}×{h}px | {label} | contrast={data.get('contrast')}")

        # Rule 1: Touch target
        v = check_touch_target(w, h, min_touch)
        if v:
            _ask_and_update(profile, "touch_target_size", v, data, element_record, audit_report)

        # Rule 2: Contrast ratio
        if not data.get("is_icon"):
            v = check_contrast(data.get("contrast"), min_contrast, data.get("text"))
            if v:
                _ask_and_update(profile, "contrast_ratio", v, data, element_record, audit_report)

        # Rule 3: Unreadable height
        if h < 16 and not data.get("is_icon"):
            v = {"rule": "min_readable_height",
                 "desc": f"Text element {h}px — likely unreadable",
                 "actual": f"{h}px", "required": "16px"}
            _ask_and_update(profile, "min_readable_height", v, data, element_record, audit_report)

        audit_report["elements"].append(element_record)

    def json_safe(o):
        if isinstance(o, (np.int64, np.int32)): return int(o)
        if isinstance(o, (np.float64, np.float32)): return float(o)
        return str(o)

    with open(output_file, 'w') as f:
        json.dump(audit_report, f, indent=4, default=json_safe)

    metrics.record_run(profile, audit_report, agent)

    print(f"\n{'='*60}")
    print(f"  ✅ AUDIT COMPLETE")
    print(f"  Score      : {audit_report['summary']['score']}/100")
    print(f"  Violations : {audit_report['summary']['violations']}")
    print(f"  Q-States   : {len(agent.q_table)} (model growing)")
    print(f"  Accuracy   : {agent.get_accuracy():.1f}%")
    print(f"  Epsilon    : {agent.epsilon:.4f} (↓ = less random, more confident)")
    print(f"{'='*60}")

    if show_weights:
        agent.print_all_weights()

    metrics.print_summary(profile)
    return audit_report

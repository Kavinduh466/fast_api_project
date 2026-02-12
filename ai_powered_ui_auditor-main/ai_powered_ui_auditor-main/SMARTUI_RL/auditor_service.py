import os
import sys

# --- PROTECT AGAINST SEGFAULTS ON MACOS ---
# These MUST be set before importing torch or cv2
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import cv2
import torch
# Disable OpenCV multi-threading which often conflicts with Torch/OpenMP
cv2.setNumThreads(0)
torch.set_num_threads(1)

import numpy as np
from ultralytics import YOLO, settings
from ctransformers import AutoModelForCausalLM
from SMARTUI_RL.rule_engine import RuleEngine
from SMARTUI_RL.audit_utils import analyze_element_content, _get_reader
from SMARTUI_RL.rl_feedback import FeedbackLearner

# --- STABILITY SETTINGS ---
# Prevent OpenMP and Threading conflicts on macOS
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
torch.set_num_threads(1)

# Disable Ultralytics telemetry and updates to prevent blocking
try:
    settings.update({'sync': False, 'uuid': '0', 'api_key': ''})
except Exception as e:
    print(f"⚠️ Could not update all Ultralytics settings: {e}")

# --- GLOBAL MODELS (Singletons) ---
models = {
    "vision": None,
    "llm": None,
    "engine": None,
    "rl": None
}

# Pre-resolve paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "ui_model.pt")
LLM_PATH = os.path.join(BASE_DIR, "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf")
EXCEL_PATH = os.path.join(BASE_DIR, "UI_RULE_SETS.xlsx")

# --- VIOLET RULES (Text-Based Policy Rules) ---
# These are the design principles evaluated by the LLM against the UI.
# They match what the frontend VioletRulesPage expects.
VIOLET_RULES = [
    {
        "rule": "clarity_and_simplicity",
        "title": "Clarity and Simplicity",
        "description": "Simplify the interface and remove unnecessary elements.",
        "prompt_hint": "clarity, simplicity, minimalism"
    },
    {
        "rule": "visual_hierarchy",
        "title": "Visual Hierarchy",
        "description": "Use size, color, and weight to show importance. The most important thing should be the easiest to see.",
        "prompt_hint": "visual hierarchy, size/color/weight importance ordering"
    },
    {
        "rule": "consistency",
        "title": "Consistency",
        "description": "Maintain consistency in design and behavior.",
        "prompt_hint": "consistency, patterns, standards"
    },
    {
        "rule": "contrast_ratio",
        "title": "Contrast Ratio",
        "description": "Ensure enough contrast between text and background. Aim for at least 4.5:1 for normal text to maintain accessibility.",
        "prompt_hint": "text contrast ratio, WCAG accessibility, readability"
    },
    {
        "rule": "rule_of_proximity",
        "title": "Rule of Proximity",
        "description": "Place related items close together (e.g., a label next to its input field) so users perceive them as a group.",
        "prompt_hint": "proximity grouping, related elements placed together"
    },
    {
        "rule": "the_60-30-10_rule",
        "title": "The 60-30-10 Rule",
        "description": "For color, use a primary color for 60%, a secondary for 30%, and an accent color (like for buttons) for 10%.",
        "prompt_hint": "color distribution, 60-30-10 color balance"
    },
    {
        "rule": "visibility_of_system_status",
        "title": "Visibility of System Status",
        "description": "Always tell the user what's happening. If something is loading, show a progress bar or spinner.",
        "prompt_hint": "system status feedback, loading indicators, progress communication"
    },
    {
        "rule": "user_control_&_freedom",
        "title": "User Control & Freedom",
        "description": "Always give users an 'emergency exit.' Let them easily undo, redo, or cancel an action.",
        "prompt_hint": "user control, undo/redo/cancel, emergency exit options"
    },
    {
        "rule": "perceivable_content",
        "title": "Perceivable Content",
        "description": "Ensure content is perceivable by all users, including those with disabilities.",
        "prompt_hint": "WCAG, accessibility, perceivable"
    }
]


def get_vision_model():
    """Lazy loader for YOLOv5."""
    if models["vision"] is None:
        print(f"📥 Loading Vision Model: {MODEL_PATH}...")
        # Force CPU and single thread for stability
        models["vision"] = YOLO(MODEL_PATH)
    return models["vision"]

def get_llm():
    """Lazy loader for TinyLlama."""
    if models["llm"] is None:
        print(f"📥 Loading LLM Model: {LLM_PATH}...")
        models["llm"] = AutoModelForCausalLM.from_pretrained(
            "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
            model_file=LLM_PATH,
            model_type="llama",
            threads=1, # Safer for background threads
            gpu_layers=0,
            context_length=2048
        )
    return models["llm"]

def get_engine():
    """Lazy loader for Rule Engine."""
    if models["engine"] is None:
        print(f"📥 Loading Rule Engine: {EXCEL_PATH}...")
        models["engine"] = RuleEngine(excel_file=EXCEL_PATH)
    return models["engine"]

def get_rl():
    """Lazy loader for RL Feedback Learner."""
    if models["rl"] is None:
        models["rl"] = FeedbackLearner(memory_file=os.path.join(BASE_DIR, "rl_memory.json"))
    return models["rl"]


def _evaluate_violet_rules(llm, engine, summary_text: str, elements_summary: str, profile: str, rl) -> list:
    """
    Uses the LLM to evaluate text-based design policy rules (violet rules)
    against the audit summary and detected elements.
    Returns a list of violation dicts for rules that are violated.
    """
    text_rule_violations = []

    if not llm:
        print("⚠️ LLM not available, skipping violet rule evaluation")
        return text_rule_violations

    # Combine predefined rules with rules from Excel
    # We use the Excel rules as the source of truth, but map them to frontend IDs for better display
    excel_rules = engine.text_rules if engine and engine.text_rules else []
    
    # If no excel rules, fall back to a subset of predefined ones to ensure some output
    if not excel_rules:
        excel_rules = [{"name": r["title"], "description": r["description"]} for r in VIOLET_RULES]

    print(f"🟣 Evaluating {len(excel_rules)} Text Rules from Excel/Policy using LLM...")

    for rule_obj in excel_rules:
        rule_desc = rule_obj["description"]
        rule_name = rule_obj["name"].lower().replace(" ", "_")
        rule_title = rule_obj["name"]
        
        # Check RL policy
        if not rl.should_flag_violation(profile, rule_name):
            print(f"   🛡️ Rule '{rule_title}' filtered out by RL feedback")
            continue

        # IMPROVED EVALUATIVE PROMPT
        prompt = f"""[INST] <<SYS>>
You are a meticulous UI/UX Auditor. Your goal is to find violations of design principles.
<</SYS>>

CONTEXT:
{summary_text}
{elements_summary}

RULE TO EVALUATE:
"{rule_desc}"

TASK:
1. Carefully analyze if the detected elements violate this rule.
2. If it is VIOLATED, provide a short, specific reason why (e.g., "The button 'Submit' has low contrast against the background").
3. If it is NOT violated, answer with "PASSED".

Format:
STATUS: [VIOLATED or PASSED]
REASON: [Short explanation if violated, otherwise omit]
[/INST]"""

        try:
            response = llm(prompt, max_new_tokens=96, temperature=0.2)
            lines = [l.strip() for l in response.strip().split('\n') if l.strip()]
            
            is_violated = any("VIOLATED" in l.upper() for l in lines[:2])
            
            if is_violated:
                reason = "Violation detected."
                for l in lines:
                    if "REASON:" in l.upper():
                        reason = l.split(":", 1)[1].strip()
                        break
                
                # If reason is too short or just repeats status, use the description
                if len(reason) < 5 or "VIOLATED" in reason.upper():
                    reason = rule_desc

                text_rule_violations.append({
                    "rule": rule_name,
                    "title": rule_title,
                    "description": reason,
                    "violated": True
                })
                print(f"   ❌ Rule VIOLATED: {rule_title} - {reason[:50]}...")
            else:
                text_rule_violations.append({
                    "rule": rule_name,
                    "title": rule_title,
                    "description": "Rule satisfied. No violation detected.",
                    "violated": False
                })
                print(f"   ✅ Rule PASSED: {rule_title}")

        except Exception as e:
            print(f"   ⚠️ Error evaluating rule: {e}")

    actual_violations = len([v for v in text_rule_violations if v.get("violated")])
    print(f"🟣 Violet Rules evaluation complete: {actual_violations} violations found")
    return text_rule_violations


def run_smart_audit(image_path: str, profile: str = "universal") -> dict:
    """
    Runs the full SMARTUI_RL audit pipeline on a single image.
    1. YOLO element detection
    2. Deep inspection (OCR, Colors, Contrast)
    3. Rule engine check (math rules)
    4. Violet rules evaluation (text-based policy rules via LLM)
    5. LLM consultation (general analysis)
    """
    engine = get_engine()
    vision_model = get_vision_model()
    rl = get_rl()

    if not vision_model:
        return {"error": "Vision model could not be initialized"}

    # Load profile rules
    engine.load_rules(profile)
    MIN_BTN = engine.get("min_button_height")
    MIN_FIELD = engine.get("min_field_height")

    # 1. Vision Detection
    if not os.path.exists(image_path):
        return {"error": f"Image file not found at: {image_path}"}
        
    print(f"👁️ Running YOLO Detection on: {image_path}...")
    try:
        # Simplest possible call, forcing CPU
        results = vision_model(image_path, conf=0.15, verbose=False, device='cpu')
        num_boxes = len(results[0].boxes) if results else 0
        print(f"✅ Detection complete. Found {num_boxes} elements.")
    except Exception as e:
        print(f"❌ YOLO Inference Error: {e}")
        return {"error": f"YOLO Inference failed: {str(e)}"}

    if not results or len(results[0].boxes) == 0:
        return {"summary": {"score": 100, "violations": 0}, "elements": [], "text_rule_violations": [], "message": "No UI elements detected."}

    # Load Image for Color Analysis
    original_img = cv2.imread(image_path)
    if original_img is None:
        return {"error": f"Could not read image at {image_path}"}

    boxes = results[0].boxes.xyxy.cpu().numpy()
    classes = results[0].boxes.cls.cpu().numpy()
    
    stats = {"violations_list": [], "total": len(boxes)}
    elements = []

    print(f"🔍 Analyzing {len(boxes)} elements with deep inspection...")

    for i, box in enumerate(boxes):
        print(f"   [{i+1}/{len(boxes)}] Analyzing element at {box}...")
        cls_id = int(classes[i])
        class_name = vision_model.names[cls_id].lower()
        x1, y1, x2, y2 = map(int, box)
        height = y2 - y1
        
        # --- Deep Inspection ---
        h_img, w_img = original_img.shape[:2]
        crop = original_img[max(0, y1):min(h_img, y2), max(0, x1):min(w_img, x2)]
        
        element_data = {"text": "Unknown", "contrast": None}
        if crop.size > 0:
            element_data = analyze_element_content(crop)
        
        text_found = element_data.get("text", "Unknown")
        contrast = element_data.get("contrast")
        
        issues = []
        status = "PASS"

        # --- Math Rule Checks (Name-Based) ---
        print(f"   📋 Checking rules for {class_name} (ID {cls_id})...")
        
        # 1. Button Size Rules
        is_button = "button" in class_name or class_name in ["bbu", "buttons"]
        if is_button:
            if height < MIN_BTN:
                if rl.should_flag_violation(profile, "min_button_height"):
                    desc = f"Button '{text_found}' is too small ({height}px vs {MIN_BTN}px)."
                    issues.append({"rule": "min_button_height", "desc": desc})
                    stats["violations_list"].append(desc)
                    status = "FAIL"
                    print(f"      ❌ Violation: min_button_height (Confirmed by RL)")
                else:
                    print(f"      🛡️ Violation filtered out by RL for min_button_height")
            
            # Button Contrast
            if contrast and contrast < 3.0: # Standard for UI components
                if rl.should_flag_violation(profile, "contrast_ratio"):
                    desc = f"Accessibility: Button '{text_found}' has low contrast ({contrast}:1)."
                    issues.append({"rule": "contrast_ratio", "desc": desc})
                    stats["violations_list"].append(desc)
                    status = "FAIL"
                    print(f"      ❌ Violation: contrast_ratio (Confirmed by RL)")
        
        # 2. Input/Field Size Rules
        is_field = any(k in class_name for k in ["input", "field", "lable", "label"])
        if is_field:
            if height < MIN_FIELD:
                if rl.should_flag_violation(profile, "min_field_height"):
                    desc = f"Input '{text_found}' is too small ({height}px vs {MIN_FIELD}px)."
                    issues.append({"rule": "min_field_height", "desc": desc})
                    stats["violations_list"].append(desc)
                    status = "FAIL"
                    print(f"      ❌ Violation: min_field_height (Confirmed by RL)")
                else:
                    print(f"      🛡️ Violation filtered out by RL for min_field_height")

        # 3. Section/Container Rules (Notebook behavior: treat large text sections as blocks)
        is_container = class_name in ["section", "container", "card", "banner"]
        if is_container:
            # If a section is surprisingly small but contains text, it might be a button misclassified
            if height < 100 and len(text_found) > 0:
               if rl.should_flag_violation(profile, "min_button_height"):
                    desc = f"Element '{text_found}' ({class_name.title()}) is small ({height}px). Might be hard to interact with."
                    issues.append({"rule": "min_button_height", "desc": desc})
                    stats["violations_list"].append(desc)
                    status = "FAIL"
                    print(f"      ❌ Violation: section_size (Flagged as small section)")

        elements.append({
            "id": i,
            "type": class_name,
            "cls_id": cls_id,
            "bbox": [x1, y1, x2, y2],
            "content": element_data,
            "issues": issues,
            "status": status
        })

    # Summary Text for LLM
    num_math_violations = len(stats["violations_list"])
    summary_text = f"""
    - AUDIT PROFILE: {profile.upper()}
    - Total Elements Scanned: {stats['total']}
    - MATH VIOLATIONS FOUND: {num_math_violations}
    """

    # Build a concise elements summary for violet rule evaluation
    elements_summary_parts = []
    for el in elements[:10]:  # Limit to first 10 elements to keep prompt short
        content = el.get("content", {})
        text = content.get("text", "Unknown")[:50]
        contrast_val = content.get("contrast", "N/A")
        el_status = el.get("status", "PASS")
        elements_summary_parts.append(f"  - Element {el['id']} (cls={el['cls_id']}): text='{text}', contrast={contrast_val}, status={el_status}")
    elements_summary = "DETECTED ELEMENTS:\n" + "\n".join(elements_summary_parts)

    # 4. Violet Rules Evaluation (Text-based policy checks via LLM)
    llm = get_llm()
    text_rule_violations = _evaluate_violet_rules(llm, engine, summary_text, elements_summary, profile, rl)

    # 5. LLM General Consultation
    llm_analysis = "LLM analysis not available"
    if llm:
        extra_context = ""
        if engine.text_rules:
            short_rules = [r['description'][:100] + "..." if len(r['description']) > 100 else r['description'] for r in engine.text_rules[:2]]
            extra_context = "\nPOLICY HIGHLIGHTS:\n" + "\n".join(f"- {r}" for r in short_rules)

        all_violations_list = stats['violations_list'][:2]
        if text_rule_violations:
            all_violations_list += [v["title"] for v in text_rule_violations[:2]]

        history = f"""
Hook: Senior UX Auditor. Topic: {profile} App.
DATA: {summary_text} {extra_context}
ERRORS: {all_violations_list}
Task: Explain why these errors matter for {profile}. Mention the Policies if relevant. Keep it short (2 sentences max per point).
"""
        print(f"🤖 AI Consultant: Analyzing Rules using TinyLlama (this may take 30-60s on CPU)...")
        try:
            llm_analysis = llm(history, max_new_tokens=128, temperature=0.6)
            print("✅ LLM Analysis complete.")
        except Exception as e:
            print(f"LLM Error: {e}")
            llm_analysis = f"Error during AI analysis: {str(e)}"

    # Final Report
    num_text_violations = len([v for v in text_rule_violations if v.get("violated")])
    total_violations = num_math_violations + num_text_violations
    score = max(0, 100 - (total_violations * 10))
    print(f"\n--- [Final Audit Summary] ---")
    print(f"Math Violations: {num_math_violations}")
    print(f"Violet Rules Evaluated: {len(text_rule_violations)}")
    print(f"Violet Rule Violations: {num_text_violations}")
    print(f"Total Violations: {total_violations}")
    print(f"Calculated Score: {score}")
    print(f"LLM Analysis Length: {len(llm_analysis)} chars")

    # Prepare Unified Violations List for the Frontend
    unified_violations = []
    
    # 1. Add math violations from elements (styled consistently)
    for element in elements:
        for issue in element.get("issues", []):
            unified_violations.append({
                "rule": issue.get("rule", "Math Policy"),
                "title": issue.get("rule", "Math Policy").replace("_", " ").title(),
                "description": issue.get("desc", "A math-based rule was violated."),
                "violated": True,
                "element_id": element.get("id")
            })
            
    # 2. Add text rule violations
    for v in text_rule_violations:
        unified_violations.append({
            "rule": v.get("rule"),
            "title": v.get("title"),
            "description": v.get("description"),
            "violated": v.get("violated")
        })

    report = {
        "meta": {
            "profile": profile,
            "timestamp": str(np.datetime64('now'))
        },
        "summary": {
            "score": score,
            "violations": total_violations
        },
        "violations": unified_violations,
        "elements": elements,
        "text_rule_violations": text_rule_violations,
        "llm_analysis": llm_analysis
    }

    return report

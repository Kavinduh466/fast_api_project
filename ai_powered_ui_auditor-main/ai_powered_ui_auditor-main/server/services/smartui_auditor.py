import os
from typing import Dict, List, Any
from SMARTUI_RL.auditor_service import run_smart_audit
from server.config import SMARTUI_RL_DIR, UPLOAD_DIR



def run_smart_image_audit(image_path: str, profile: str = "universal") -> Dict[str, Any]:
    """
    Runs the AI audit pipeline on an uploaded image file.
    """
    print(f"🤖 Calling SMARTUI_RL Model for uploaded image...")
    raw_result = run_smart_audit(image_path, profile)

    if "error" in raw_result:
        print(f"❌ AI Model Error: {raw_result['error']}")
        return raw_result

    return _transform_audit_result(raw_result, profile)

def _transform_audit_result(raw_result: Dict[str, Any], profile: str) -> Dict[str, Any]:
    """Common logic to transform raw AI model output for the frontend."""
    transformed_violations = []
    
    # Process element-level violations (math rules)
    for element in raw_result.get("elements", []):
        for issue in element.get("issues", []):
            transformed_violations.append({
                "id": len(transformed_violations) + 1,
                "rule": issue.get("rule", "Unknown"),
                "title": _map_rule_to_title(issue.get("rule")),
                "description": issue.get("desc", ""),
                "violated": True,
                "element_info": {
                    "type": element.get("cls_id"),
                    "bbox": element.get("bbox"),
                    "content": element.get("content")
                }
            })

    # Process page-level text rules (violet rules)
    for issue in raw_result.get("text_rule_violations", []):
        transformed_violations.append({
            "id": len(transformed_violations) + 1,
            "rule": issue.get("rule", "Unknown"),
            "title": issue.get("title", _map_rule_to_title(issue.get("rule"))),
            "description": issue.get("description", ""),
            "violated": issue.get("violated", True),
            "element_info": None # Page level rule
        })

    final_response = {
        "meta": {
            **raw_result.get("meta", {}),
            "profile": profile
        },
        "summary": raw_result.get("summary", {}),
        "violations": transformed_violations,
        "elements": raw_result.get("elements", []),
        "llm_analysis": raw_result.get("llm_analysis")
    }

    return final_response

def _map_rule_to_title(rule_name: str) -> str:
    """Maps internal rule names to user-friendly titles."""
    mapping = {
        "min_button_height": "Button Size Check",
        "min_field_height": "Input Field Accessibility",
        "contrast_ratio": "Contrast Ratio Check",
        "max_misalignment": "Alignment Accuracy",
        "visual_hierarchy": "Visual Hierarchy",
        "rule_of_proximity": "Rule of Proximity",
        "the_60-30-10_rule": "The 60-30-10 Rule",
        "visibility_of_system_status": "Visibility of System Status",
        "user_control_&_freedom": "User Control & Freedom",
        "clarity_and_simplicity": "Clarity and Simplicity"
    }
    return mapping.get(rule_name, rule_name.replace("_", " ").title())

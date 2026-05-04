"""
smartui_auditor.py  (server/services/)
=======================================
Server-layer orchestration bridging the FastAPI routers to SMARTUI_RL.

Uses:
  SMARTUI_RL.auditor_service  → run_smart_audit()
  SMARTUI_RL.rl_feedback      → FeedbackLearner  (Q-Learning agent)

Job store: in-memory dict keyed by job_id.
Each job holds the full violation queue so the frontend can step through
one violation at a time with y/n feedback.
"""

import os
import sys
import uuid
from typing import Dict, Any, Optional

from server.config import SMARTUI_RL_DIR, UPLOAD_DIR

# ── Ensure SMARTUI_RL package is importable ────────────────────────────────────
SMARTUI_RL_PATH = str(SMARTUI_RL_DIR)
if SMARTUI_RL_PATH not in sys.path:
    sys.path.insert(0, SMARTUI_RL_PATH)

# ── In-memory job store ────────────────────────────────────────────────────────
_active_jobs: Dict[str, Dict] = {}


# ── Public API ─────────────────────────────────────────────────────────────────

def run_smart_image_audit(image_path: str, profile: str = "universal") -> Dict[str, Any]:
    """
    Entry point for POST /audit/smart.

    Calls run_smart_audit() from auditor_service (which handles YOLO,
    OCR, metric checks, LLM text-rule evaluation and the RL gate internally),
    then wraps the result into a job with a sequential violation queue.
    """
    print(f"[SmartUI] Audit start: {image_path}  profile={profile}")

    # Import here (lazy) so server starts even if models aren't loaded yet
    from SMARTUI_RL.auditor_service import run_smart_audit, get_rl

    raw = run_smart_audit(image_path=image_path, profile=profile)

    if "error" in raw:
        return raw

    rl = get_rl()
    return _build_job(raw, profile, rl)


def apply_feedback(job_id: str, profile: str, rule_slug: str,
                   answer: str, element_info: Dict) -> Dict[str, Any]:
    """
    Entry point for POST /audit/smart/feedback.

    `rule_slug` here is what audit.py sends — it maps to `rule_id` in the
    new violation objects (e.g. "UNI-009").  Both names are accepted.

    answer "y" → reward +1  → Q[show] rises  → agent flags more often
    answer "n" → reward -1  → Q[show] falls  → agent suppresses in future
    """
    from SMARTUI_RL.auditor_service import get_rl

    rl             = get_rl()
    user_confirmed = (answer == "y")
    reward         = 1 if user_confirmed else -1

    # rule_slug from audit.py == rule_id in our violation objects
    rule_id = rule_slug

    msg        = rl.update_policy(profile=profile, rule_id=rule_id,
                                  user_feedback=reward)
    confidence = rl.get_rule_confidence(profile, rule_id)

    # Update job store
    job = _active_jobs.get(job_id)
    if job:
        for v in job.get("violations", []):
            if v.get("rule_id") == rule_id and v.get("status") == "pending":
                v["status"] = "confirmed" if user_confirmed else "false_positive"
                break

        if user_confirmed:
            job["summary"]["violations"] = job["summary"].get("violations", 0) + 1
            job["summary"]["score"]      = max(0, job["summary"].get("score", 100) - 8)

    next_v    = _next_pending(job_id)
    remaining = _count_pending(job_id)

    result: Dict[str, Any] = {
        "job_id": job_id,
        "last_feedback": {
            "rule_id":    rule_id,
            "answer":     answer,
            "rl_message": msg,
            "confidence": confidence,
        },
        "rl_model":  _rl_stats(rl),
        "remaining": remaining,
        "score":     job["summary"]["score"] if job else 100,
    }

    if next_v:
        result["done"]           = False
        result["next_violation"] = next_v
        result["message"]        = f"{remaining} violation(s) remaining."
    else:
        result["done"]    = True
        result["message"] = "All violations reviewed. Audit complete."
        if job:
            confirmed = sum(1 for v in job.get("violations", [])
                            if v.get("status") == "confirmed")
            fp        = sum(1 for v in job.get("violations", [])
                            if v.get("status") == "false_positive")
            result["final_summary"] = {
                "score":                job["summary"]["score"],
                "violations_confirmed": confirmed,
                "false_positives":      fp,
                "suppressed_by_rl":     job.get("suppressed_count", 0),
                "rl_model":             _rl_stats(rl),
            }

    return result


# ── Private helpers ────────────────────────────────────────────────────────────

def _build_job(raw: dict, profile: str, rl) -> dict:
    """
    Convert run_smart_audit() output into a job dict with a violation queue.

    Violations that were already suppressed by the RL gate inside
    auditor_service (violated=False, source='rl_suppressed') are separated
    into the suppressed list so the frontend can optionally show them.
    """
    job_id     = str(uuid.uuid4())[:8]
    pending    = []
    suppressed = []

    for v in raw.get("violations", []):
        is_suppressed = (v.get("source") == "rl_suppressed")
        is_violated   = v.get("violated") is True
        is_passed     = v.get("violated") is False and not is_suppressed

        record = {
            "id":               len(pending) + len(suppressed) + 1,
            "job_id":           job_id,
            "rule_id":          v.get("rule_id", "UNKNOWN"),
            "rule_slug":        v.get("rule_id", "UNKNOWN"),
            "rule_name":        v.get("rule_name", "Unknown Rule"),
            "rule_title":       v.get("rule_name", "Unknown Rule"),
            "description":      v.get("description", ""),
            "source":           v.get("source", "metric"),
            "violated":         v.get("violated"),
            # violated rules = pending (user gives feedback)
            # passed rules   = view_only (shown but no feedback needed)
            # suppressed      = suppressed_by_rl (hidden from user)
            "status":           "suppressed_by_rl" if is_suppressed
                                else "pending" if is_violated
                                else "view_only",
            "element_id":       v.get("element_id"),
            "element_bbox":     None,
            "element_text":     None,
            "element_height":   50,
            "element_contrast": None,
        }

        # Enrich with element detail if available
        elem_id = v.get("element_id")
        if elem_id is not None:
            for el in raw.get("elements", []):
                if el.get("id") == elem_id:
                    record["element_bbox"]     = el.get("bbox")
                    record["element_text"]     = el.get("content", {}).get("text")
                    record["element_height"]   = (el["bbox"][3] - el["bbox"][1]
                                                  if el.get("bbox") else 50)
                    record["element_contrast"] = el.get("content", {}).get("contrast")
                    break

        if is_suppressed:
            suppressed.append(record)
        else:
            # Both violated (pending) AND passed (view_only) go to violations
            # so the frontend can display all evaluated rules
            pending.append(record)

    job = {
        "job_id":           job_id,
        "profile":          profile,
        "summary":          {**raw.get("summary", {}), "score": 100, "violations": 0},
        "violations":       pending,
        "suppressed":       suppressed,
        "pending_count":    len(pending),
        "suppressed_count": len(suppressed),
        "first_violation":  next((v for v in pending if v["status"] == "pending"), None),
        "elements":         raw.get("elements", []),
        "llm_analysis":     raw.get("llm_analysis", ""),
        "layout":           raw.get("layout", {}),
        "rl_model":         _rl_stats(rl),
    }

    _active_jobs[job_id] = job
    print(f"[SmartUI] Job {job_id}: {len(pending)} pending, "
          f"{len(suppressed)} suppressed/passed.")
    return job


def _next_pending(job_id: str) -> Optional[dict]:
    job = _active_jobs.get(job_id)
    if not job:
        return None
    for v in job.get("violations", []):
        if v.get("status") == "pending":
            return v
    return None


def _count_pending(job_id: str) -> int:
    job = _active_jobs.get(job_id)
    if not job:
        return 0
    return sum(1 for v in job.get("violations", [])
               if v.get("status") == "pending")


def _rl_stats(rl) -> dict:
    """Build a stats dict from FeedbackLearner for the frontend."""
    weights    = rl.weights
    total      = len(weights)
    suppressed = sum(1 for q in weights.values() if q < 0.4)
    enforced   = sum(1 for q in weights.values() if q > 0.7)

    # Safely retrieve total_updates — works regardless of internal attribute name
    _data        = getattr(rl, '_data', None) or getattr(rl, 'data', None) or {}
    interactions = (_data.get("metadata", {}).get("total_updates", 0)
                    if isinstance(_data, dict) else 0)

    return {
        "q_states":     total,
        "suppressed":   suppressed,
        "enforced":     enforced,
        "neutral":      total - suppressed - enforced,
        "accuracy":     round((suppressed + enforced) / total * 100, 1) if total else 0.0,
        "interactions": interactions,
    }
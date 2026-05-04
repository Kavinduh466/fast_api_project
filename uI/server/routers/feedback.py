"""
feedback.py  (server/routers/)
================================
Routes:
  POST /audit/feedback        → Single rule feedback → Q-table update
  POST /audit/feedback/batch  → Multiple rules at once

Compatible with the new FeedbackLearner (rl_feedback.py) which uses
`rule_id` (e.g. "UNI-009") as the state key, not a slug string.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from SMARTUI_RL.auditor_service import get_rl

router = APIRouter(prefix="/audit/feedback", tags=["feedback"])


# ── Request models ─────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    profile:   str
    rule_id:   str        # Excel Rule ID e.g. "UNI-009", "HEALTH-001"
    rule_name: Optional[str] = None   # kept for display only, not used in Q-update
    feedback:  int        # +1 = confirmed violation  |  -1 = false positive


class FeedbackItem(BaseModel):
    rule_id:   str
    rule_name: Optional[str] = None
    feedback:  int        # +1 or -1


class BatchFeedbackRequest(BaseModel):
    profile: str
    items:   List[FeedbackItem]


# ── Single feedback ────────────────────────────────────────────────────────────

@router.post("", summary="Submit RL feedback for one rule violation")
async def submit_feedback(request: FeedbackRequest):
    """
    Updates the Q-Learning agent for one rule.

    feedback +1 → designer confirmed the violation → Q[show] increases
    feedback -1 → designer dismissed (false positive) → Q[show] decreases

    After enough -1 votes the agent will suppress this rule for this profile
    automatically in future audits.
    """
    if request.feedback not in (1, -1):
        raise HTTPException(status_code=400, detail="feedback must be +1 or -1")

    try:
        print(f"\n[feedback] POST /audit/feedback  "
              f"profile={request.profile}  rule_id={request.rule_id}  "
              f"feedback={request.feedback}")

        rl      = get_rl()
        message = rl.update_policy(
            profile       = request.profile,
            rule_id       = request.rule_id,
            user_feedback = request.feedback,
        )
        confidence = rl.get_rule_confidence(request.profile, request.rule_id)

        print(f"[feedback] {message}")
        return {
            "status":     "success",
            "message":    message,
            "confidence": confidence,
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Batch feedback ─────────────────────────────────────────────────────────────

@router.post("/batch", summary="Submit RL feedback for multiple rules at once")
async def submit_batch_feedback(request: BatchFeedbackRequest):
    """
    Batch Q-update for all rules the designer rated in one session.
    Typical use: designer reviews the full violation list and submits all
    thumbs-up / thumbs-down at once when closing the audit report.
    """
    bad = [i for i in request.items if i.feedback not in (1, -1)]
    if bad:
        raise HTTPException(
            status_code=400,
            detail=f"All feedback values must be +1 or -1. Bad items: {[b.rule_id for b in bad]}"
        )

    try:
        print(f"\n[feedback] POST /audit/feedback/batch  "
              f"profile={request.profile}  items={len(request.items)}")

        rl      = get_rl()
        results = []

        for item in request.items:
            message    = rl.update_policy(
                profile       = request.profile,
                rule_id       = item.rule_id,
                user_feedback = item.feedback,
            )
            confidence = rl.get_rule_confidence(request.profile, item.rule_id)
            results.append({
                "rule_id":    item.rule_id,
                "rule_name":  item.rule_name,
                "message":    message,
                "confidence": confidence,
            })
            print(f"  → {item.rule_id}  fb={item.feedback}  {message}")

        return {"status": "success", "results": results}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
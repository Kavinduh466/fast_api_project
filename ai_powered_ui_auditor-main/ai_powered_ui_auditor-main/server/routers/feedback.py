from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from SMARTUI_RL.auditor_service import get_rl

router = APIRouter(prefix="/audit/feedback", tags=["feedback"])

class FeedbackRequest(BaseModel):
    profile: str
    rule_name: str
    feedback: int # +1 for agree, -1 for disagree

class FeedbackItem(BaseModel):
    rule_name: str
    feedback: int  # +1 for agree, -1 for disagree

class BatchFeedbackRequest(BaseModel):
    profile: str
    items: List[FeedbackItem]

@router.post("", summary="Submit RL feedback for a rule violation")
async def submit_feedback(request: FeedbackRequest):
    """
    Submits user feedback to the Reinforcement Learning module.
    Feedback of +1 strengthens the rule, -1 relaxes it.
    """
    try:
        print(f"\n--- [API POST /audit/feedback] ---")
        print(f"User Feedback: Rule={request.rule_name}, Feedback={request.feedback} (+1=Agree, -1=Disagree)")
        
        rl = get_rl()
        message = rl.update_policy(
            profile=request.profile,
            rule_name=request.rule_name,
            user_feedback=request.feedback
        )
        print(f"RL Policy Result: {message}")
        return {"status": "success", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/batch", summary="Submit batch RL feedback for multiple rules")
async def submit_batch_feedback(request: BatchFeedbackRequest):
    """
    Submits user feedback for multiple rules at once.
    Each item contains a rule_name and feedback (+1 agree, -1 disagree).
    """
    try:
        print(f"\n--- [API POST /audit/feedback/batch] ---")
        print(f"Batch Feedback: {len(request.items)} rules, Profile={request.profile}")
        
        rl = get_rl()
        results = []
        for item in request.items:
            message = rl.update_policy(
                profile=request.profile,
                rule_name=item.rule_name,
                user_feedback=item.feedback
            )
            results.append({"rule_name": item.rule_name, "message": message})
            print(f"  → {item.rule_name}: feedback={item.feedback}, result={message}")
        
        return {"status": "success", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


"""
audit.py  (server/routers/)
============================
Routes:
  POST /audit                    → Classic FAISS audit (unchanged)
  POST /audit/smart              → RL-powered audit (YOLO + LLM + Q-Learning)
  POST /audit/smart/feedback     → Submit y/n, update Q-table, get next violation
  GET  /audit/report/{id}        → Annotated report image (unchanged)
"""

import os
import uuid
import shutil

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Form
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional

from server.config import UPLOAD_DIR
from server.services.auditor import run_audit
from server.services.smartui_auditor import run_smart_image_audit, apply_feedback

router = APIRouter(prefix="/audit", tags=["audit"])


# ── REQUEST MODELS ─────────────────────────────────────────────────────────────

class SmartFeedbackRequest(BaseModel):
    job_id:            str
    profile:           str            = "universal"
    rule_slug:         str
    answer:            str            # "y" = real violation | "n" = false positive
    element_height:    int            = 50
    element_contrast:  Optional[float] = None


# ── CLASSIC AUDIT (unchanged) ──────────────────────────────────────────────────

@router.post("", summary="Classic FAISS element-similarity audit")
async def audit_ui(
    file: UploadFile = File(...),
    # Optional expert-library category to score against.
    # "universal" / missing  →  search across every category (legacy behaviour).
    # Anything else (e.g. "Medical", "Finance") restricts FAISS matches to
    # expert crops whose path starts with Expert_Library/<category>/.
    category: Optional[str] = Form(None),
):
    file_id    = str(uuid.uuid4())
    file_ext   = os.path.splitext(file.filename)[1] if file.filename else ".png"
    input_path = os.path.join(str(UPLOAD_DIR), f"{file_id}{file_ext}")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    norm_category = (category or "").strip()
    if norm_category.lower() in ("", "universal", "all"):
        norm_category = None

    print(f"[Router] POST /audit  file={file.filename}  category={norm_category or 'universal'}")

    result = run_audit(input_path, category=norm_category)
    return JSONResponse(content=result)


# ── SMART AUDIT ────────────────────────────────────────────────────────────────

@router.post("/smart", summary="RL-powered UI audit (YOLO + Q-Learning + LLM)")
async def smart_audit_ui(
    file: UploadFile = File(...),
    # Accept profile as EITHER a form field (sent by frontend FormData)
    # OR a query param (?profile=apple) — whichever the client sends.
    profile_form:  Optional[str] = Form(None),
    profile_query: str           = Query("universal"),
):
    """
    The frontend sends profile inside FormData (multipart), so it arrives as
    a form field.  Old curl-style callers send it as a query param.
    We accept both and prefer the form value when present.
    """
    profile = (profile_form or profile_query or "universal").strip().lower()

    print(f"\n[Router] POST /audit/smart  file={file.filename}  profile={profile}")

    file_id    = str(uuid.uuid4())
    file_ext   = os.path.splitext(file.filename)[1] if file.filename else ".png"
    input_path = os.path.join(str(UPLOAD_DIR), f"{file_id}{file_ext}")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = run_smart_image_audit(input_path, profile)

    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


# ── SEQUENTIAL FEEDBACK ────────────────────────────────────────────────────────

@router.post("/smart/feedback", summary="Submit y/n feedback — updates Q-Learning model")
async def smart_feedback(req: SmartFeedbackRequest):
    print(f"\n[Router] POST /audit/smart/feedback  "
          f"job={req.job_id}  rule={req.rule_slug}  answer={req.answer}")

    if req.answer not in ("y", "n"):
        raise HTTPException(status_code=400, detail="answer must be 'y' or 'n'")

    result = apply_feedback(
        job_id       = req.job_id,
        profile      = req.profile,
        rule_slug    = req.rule_slug,
        answer       = req.answer,
        element_info = {
            "height":   req.element_height,
            "contrast": req.element_contrast,
        },
    )
    return result


# ── REPORT IMAGE (unchanged) ───────────────────────────────────────────────────

@router.get("/report/{report_id}", summary="Get annotated report image")
async def get_report_image(report_id: str):
    # Prefer PNG (sharper labels); fall back to legacy JPG.
    png_path = os.path.join(str(UPLOAD_DIR), f"{report_id}_report.png")
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png")
    jpg_path = os.path.join(str(UPLOAD_DIR), f"{report_id}_report.jpg")
    if os.path.exists(jpg_path):
        return FileResponse(jpg_path, media_type="image/jpeg")
    return JSONResponse(status_code=404, content={"error": "Report not found"})
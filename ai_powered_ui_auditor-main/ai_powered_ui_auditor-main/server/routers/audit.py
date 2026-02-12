import os
import uuid
import shutil

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from server.config import UPLOAD_DIR
from server.services.auditor import run_audit
from server.services.smartui_auditor import run_smart_image_audit

router = APIRouter(prefix="/audit", tags=["audit"])


@router.post("", summary="Audit a UI screenshot (Classic)")
async def audit_ui(file: UploadFile = File(...)):
    # ... (existing classic audit logic unchanged)
    file_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ".png"
    input_path = os.path.join(str(UPLOAD_DIR), f"{file_id}{file_ext}")

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = run_audit(input_path)
    return JSONResponse(content=result)

@router.post("/smart", summary="Audit a UI screenshot (AI-Powered)")
async def smart_audit_ui(file: UploadFile = File(...), profile: str = "universal"):
    """
    Upload a UI screenshot and analyze it using the SMARTUI_RL AI model.
    """
    try:
        print(f"\n--- [API POST /audit/smart] ---")
        print(f"Incoming Image Audit: {file.filename}, Profile={profile}")

        file_id = str(uuid.uuid4())
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ".png"
        input_path = os.path.join(str(UPLOAD_DIR), f"{file_id}{file_ext}")

        with open(input_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # Run the AI-powered audit
        result = run_smart_image_audit(input_path, profile)
        
        if "error" in result:
             raise HTTPException(status_code=500, detail=result["error"])

        return result
    except Exception as e:
        print(f"Server Error during smart audit: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.get("/report/{report_id}", summary="Get annotated report image")
async def get_report_image(report_id: str):
    """Download the annotated audit report image for a given report ID."""
    report_path = os.path.join(str(UPLOAD_DIR), f"{report_id}_report.jpg")

    if os.path.exists(report_path):
        return FileResponse(report_path, media_type="image/jpeg")

    return JSONResponse(
        status_code=404, content={"error": "Report not found"}
    )

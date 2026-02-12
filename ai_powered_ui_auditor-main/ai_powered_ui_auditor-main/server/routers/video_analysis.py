"""
Video Analysis Router
Exposes POST /video-analysis/analyze endpoint for uploading webcam + screen videos.
"""
import os
import uuid
import shutil

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse

from server.config import UPLOAD_DIR
from server.services.video_analyzer import run_video_analysis

router = APIRouter(prefix="/video-analysis", tags=["video-analysis"])


@router.post("/analyze", summary="Analyze webcam + screen recordings for UI issues")
async def analyze_videos(
    screen_video: UploadFile = File(..., description="Screen recording (.webm)"),
    webcam_video: UploadFile = File(..., description="Webcam recording (.webm)")
):
    """
    Upload screen and webcam recordings for AI-powered user testing analysis.
    
    The endpoint:
    1. Saves both videos to the uploads directory
    2. Runs DeepFace emotion detection on webcam frames
    3. Runs YOLO UI element detection on screen frames when negative emotions are found
    4. Returns structured analysis with issues, timeline, and recommendations
    """
    try:
        print(f"\n--- [API POST /video-analysis/analyze] ---")
        print(f"Screen: {screen_video.filename}, Webcam: {webcam_video.filename}")

        session_id = str(uuid.uuid4())
        print(f"🆔 Generated Session ID: {session_id}")

        # Save screen video
        screen_ext = os.path.splitext(screen_video.filename or "screen.webm")[1] or ".webm"
        screen_path = os.path.join(str(UPLOAD_DIR), f"{session_id}_screen{screen_ext}")
        print(f"📥 Saving Screen Video: {screen_video.filename} -> {screen_path}")
        with open(screen_path, "wb") as f:
            shutil.copyfileobj(screen_video.file, f)

        # Save webcam video
        webcam_ext = os.path.splitext(webcam_video.filename or "webcam.webm")[1] or ".webm"
        webcam_path = os.path.join(str(UPLOAD_DIR), f"{session_id}_webcam{webcam_ext}")
        print(f"📥 Saving Webcam Video: {webcam_video.filename} -> {webcam_path}")
        with open(webcam_path, "wb") as f:
            shutil.copyfileobj(webcam_video.file, f)

        print(f"✅ Video files synchronized. Starting AI Analysis Pipeline...")

        # Run analysis
        result = run_video_analysis(webcam_path, screen_path)

        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])

        # Add session_id to result for reference
        result["session_id"] = session_id

        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"Server Error during video analysis: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Video analysis failed: {str(e)}"}
        )

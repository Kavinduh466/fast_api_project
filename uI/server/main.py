import os
import sys

# --- VITAL: PREVENT SEGFAULTS ON MACOS (M-SERIES/INTEL) ---
# These variables MUST be set before importing any ML libraries
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

try:
    import torch
    torch.set_num_threads(1)
except ImportError as e:
    msg = str(e).lower()
    if "pytorch" in msg or "torch._c" in msg or "_c" in msg:
        print(
            "\n*** PyTorch failed to load. Common causes on Windows:\n"
            "  1) You are using Python 3.13 'free-threading' / nogil build — PyTorch does not support it.\n"
            "     Fix: Install the normal CPython 3.12 or 3.13 from python.org (not experimental),\n"
            "     create a fresh venv, then: pip install -r requirements (torch + ultralytics).\n"
            "  2) Broken install. Fix: pip uninstall torch torchvision -y\n"
            "              pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu\n",
            file=sys.stderr,
        )
    raise

import cv2
cv2.setNumThreads(0)

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import ensure_upload_dir
from server.routers import audit, health, feedback, export, feedback_generator, video_analysis, uigen_audit

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
app = FastAPI(
    title="UI/UX AI Auditor API",
    description="Upload a UI screenshot and receive an AI-powered audit report.",
    version="1.0.0",
)

# CORS — allow all origins during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(audit.router)
app.include_router(health.router)
app.include_router(feedback.router)
app.include_router(export.router)
app.include_router(feedback_generator.router)
app.include_router(video_analysis.router)
app.include_router(uigen_audit.router)

_REPO_ROOT = Path(__file__).resolve().parents[1]
_PANEL_DIR = _REPO_ROOT / "panel-research-site"
_DESKTOP_RELEASES = _PANEL_DIR / "releases"


@app.get(
    "/downloads/desktop",
    summary="Download latest desktop build from panel-research-site/releases/",
)
def download_desktop():
    """
    Serves the newest .exe, .msi, .zip, or .dmg in releases/ (by mtime).
    Avoids Chrome ERR_FILE_NOT_FOUND when the panel HTML linked to a fixed filename
    that was never copied into the repo.
    """
    if not _DESKTOP_RELEASES.is_dir():
        raise HTTPException(
            status_code=404,
            detail="Create folder panel-research-site/releases/ and add a .exe, .zip, .msi, or .dmg",
        )
    allowed = {".exe", ".msi", ".zip", ".dmg"}
    files = [p for p in _DESKTOP_RELEASES.iterdir() if p.is_file() and p.suffix.lower() in allowed]
    if not files:
        raise HTTPException(
            status_code=404,
            detail="No desktop build in releases/. Add an installer or zip (e.g. your Electron output).",
        )
    chosen = max(files, key=lambda p: p.stat().st_mtime)
    return FileResponse(
        path=str(chosen),
        filename=chosen.name,
        media_type="application/octet-stream",
    )


# Static panel site (open http://127.0.0.1:8000/panel/ — download uses /downloads/desktop above)
if _PANEL_DIR.is_dir():
    app.mount(
        "/panel",
        StaticFiles(directory=str(_PANEL_DIR), html=True),
        name="panel",
    )

# Ensure upload directory exists on startup
ensure_upload_dir()

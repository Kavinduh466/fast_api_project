import os
import sys

# --- VITAL: PREVENT SEGFAULTS ON MACOS (M-SERIES/INTEL) ---
# These variables MUST be set before importing any ML libraries
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import torch
torch.set_num_threads(1)

import cv2
cv2.setNumThreads(0)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.config import ensure_upload_dir
from server.routers import audit, health, feedback, export, feedback_generator, video_analysis

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

# Ensure upload directory exists on startup
ensure_upload_dir()

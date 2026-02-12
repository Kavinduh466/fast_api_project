import os
from pathlib import Path


# Resolve the server directory (parent of this file)
SERVER_DIR = Path(__file__).resolve().parent

# Upload directory lives inside the server folder
UPLOAD_DIR = SERVER_DIR / "uploads"

# Weights directory for ML model files
WEIGHTS_DIR = SERVER_DIR / "weights"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "aq   `z")

# Asset file paths
FAISS_INDEX_PATH = SERVER_DIR / "expert_style_index.bin"
IMAGE_PATHS_FILE = SERVER_DIR / "image_paths.txt"
SMARTUI_RL_DIR = SERVER_DIR.parent / "SMARTUI_RL"


def ensure_upload_dir() -> None:
    """Create the uploads directory if it doesn't exist."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

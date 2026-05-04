import os
from pathlib import Path
from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent

# Point to ui/ai_powered_ui_auditor/.env (go up 2 levels from server/)
env_path = SERVER_DIR.parent / "ai_powered_ui_auditor" / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

UPLOAD_DIR = SERVER_DIR / "uploads"
WEIGHTS_DIR = SERVER_DIR / "weights"
FAISS_INDEX_PATH = SERVER_DIR / "expert_style_index.bin"
IMAGE_PATHS_FILE = SERVER_DIR / "image_paths.txt"
SMARTUI_RL_DIR = SERVER_DIR.parent / "SMARTUI_RL"

def ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
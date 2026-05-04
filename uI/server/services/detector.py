import torch
from ultralytics import YOLO

from server.config import WEIGHTS_DIR

# ---------------------------------------------------------------------------
# Load YOLO model ONCE at import time
# ---------------------------------------------------------------------------
_yolo_model = YOLO(str(WEIGHTS_DIR / "best.pt"))


def detect_components(image_path: str, conf: float = 0.25):
    """
    Run YOLOv8 inference on an image and return detection results.

    Parameters
    ----------
    image_path : str
        Absolute path to the input image.
    conf : float
        Minimum confidence threshold for detections.

    Returns
    -------
    results : ultralytics.engine.results.Results
        Raw YOLO results object (first frame).
    """
    results = _yolo_model(image_path, conf=conf)
    return results[0]

import torch
import clip
import cv2
import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Load CLIP model ONCE at import time
# ---------------------------------------------------------------------------
_device = "cuda" if torch.cuda.is_available() else "cpu"
_clip_model, _clip_preprocess = clip.load("ViT-B/32", device=_device)


def vectorize_crop(crop_img: np.ndarray) -> np.ndarray:
    """
    Convert a cropped UI element (BGR numpy array) to a CLIP feature vector.

    Parameters
    ----------
    crop_img : np.ndarray
        BGR image crop from OpenCV.

    Returns
    -------
    np.ndarray
        Normalised float32 feature vector of shape (1, 512).
    """
    pil_img = Image.fromarray(cv2.cvtColor(crop_img, cv2.COLOR_BGR2RGB))
    img_tensor = _clip_preprocess(pil_img).unsqueeze(0).to(_device)

    with torch.no_grad():
        features = _clip_model.encode_image(img_tensor)
        features /= features.norm(dim=-1, keepdim=True)

    return features.cpu().numpy().astype("float32")

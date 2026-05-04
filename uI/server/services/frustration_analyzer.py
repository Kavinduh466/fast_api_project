"""
Mobile Frustration Analyzer
============================
EfficientNet-B0 frustration classifier + GradCAM heatmap pipeline.

Used when platform="mobile" in the video analysis endpoint.
Replaces the YOLO-based detection with a frustration probability model
that highlights UI regions causing user frustration via GradCAM.
"""

import os
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image
from torchvision import transforms
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

from server.config import WEIGHTS_DIR

# ---------------------------------------------------------------------------
# ImageNet normalization (required by EfficientNet pretrained weights)
# ---------------------------------------------------------------------------
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

_preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
])

# Frustration probability threshold — frames above this are flagged
FRUSTRATION_THRESHOLD = 0.55

# ---------------------------------------------------------------------------
# Model: EfficientNet-B0 binary classifier
# ---------------------------------------------------------------------------

class UIFrustrationModel(nn.Module):
    """
    EfficientNet-B0 pretrained on ImageNet, fine-tuned to predict whether
    a UI screenshot is causing user frustration.

    Input:  224x224 RGB image (ImageNet-normalised)
    Output: single raw logit -> sigmoid -> frustration probability [0, 1]
    """

    def __init__(self, pretrained: bool = True):
        super().__init__()
        weights = EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = efficientnet_b0(weights=weights)

        self.features = backbone.features    # (B, 1280, H', W')
        self.avgpool = backbone.avgpool      # adaptive avg pool

        in_features = backbone.classifier[1].in_features  # 1280
        self.classifier = nn.Sequential(
            nn.Dropout(p=0.3, inplace=True),
            nn.Linear(in_features, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        x = self.classifier(x)
        return x  # raw logit

    @property
    def last_conv_layer(self) -> nn.Module:
        return self.features[-1]


# ---------------------------------------------------------------------------
# GradCAM
# ---------------------------------------------------------------------------

class GradCAM:
    """
    Gradient-weighted Class Activation Mapping.
    Produces a spatial heatmap showing which UI regions the model focused on.
    """

    def __init__(self, model: nn.Module, target_layer: Optional[nn.Module] = None):
        self.model = model
        self._activations: Optional[torch.Tensor] = None
        self._gradients: Optional[torch.Tensor] = None

        if target_layer is None:
            target_layer = model.features[-1]

        target_layer.register_forward_hook(self._hook_activations)
        target_layer.register_full_backward_hook(self._hook_gradients)

    def _hook_activations(self, module, input, output):
        self._activations = output.detach()

    def _hook_gradients(self, module, grad_input, grad_output):
        self._gradients = grad_output[0].detach()

    def generate(self, input_tensor: torch.Tensor) -> np.ndarray:
        """Compute GradCAM heatmap. Returns (H', W') float32 array in [0, 1]."""
        self.model.eval()
        self.model.zero_grad()

        input_tensor = input_tensor.detach().requires_grad_(True)
        logit = self.model(input_tensor)
        score = logit.squeeze()
        score.backward()

        # Channel importance weights
        weights = self._gradients.mean(dim=(2, 3), keepdim=True)
        cam = (weights * self._activations).sum(dim=1, keepdim=True)
        cam = F.relu(cam)

        cam_np = cam.squeeze().cpu().numpy().astype(np.float32)
        if cam_np.max() > cam_np.min():
            cam_np = (cam_np - cam_np.min()) / (cam_np.max() - cam_np.min())
        else:
            cam_np = np.zeros_like(cam_np)

        return cam_np

    def overlay(
        self,
        frame_bgr: np.ndarray,
        cam: np.ndarray,
        alpha: float = 0.45,
    ) -> np.ndarray:
        """Blend GradCAM heatmap onto the original frame (JET colormap)."""
        h, w = frame_bgr.shape[:2]
        cam_up = cv2.resize(cam, (w, h), interpolation=cv2.INTER_LINEAR)
        heatmap = cv2.applyColorMap((cam_up * 255).astype(np.uint8), cv2.COLORMAP_JET)
        blended = cv2.addWeighted(frame_bgr, 1.0 - alpha, heatmap, alpha, 0)
        return blended


def _cam_to_bounding_boxes(
    cam: np.ndarray,
    frame_h: int,
    frame_w: int,
    threshold: float = 0.5,
    max_boxes: int = 3,
) -> List[Dict[str, int]]:
    """
    Convert a GradCAM heatmap into bounding box dicts.
    Threshold the heatmap, find contours, return largest regions.
    """
    cam_resized = cv2.resize(cam, (frame_w, frame_h), interpolation=cv2.INTER_LINEAR)
    mask = (cam_resized > threshold).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        # If no contours at the threshold, use max region
        cam_resized = cv2.resize(cam, (frame_w, frame_h))
        mask = (cam_resized > 0.3).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        # Fallback: center region
        cx, cy = frame_w // 2, frame_h // 2
        return [{"x1": cx - 100, "y1": cy - 100, "x2": cx + 100, "y2": cy + 100}]

    # Sort by area, take largest
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:max_boxes]

    boxes = []
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        # Add some padding
        pad = 10
        boxes.append({
            "x1": max(0, x - pad),
            "y1": max(0, y - pad),
            "x2": min(frame_w, x + bw + pad),
            "y2": min(frame_h, y + bh + pad),
        })

    return boxes


# ---------------------------------------------------------------------------
# Lazy-loaded globals
# ---------------------------------------------------------------------------

_frustration_model: Optional[UIFrustrationModel] = None
_gradcam: Optional[GradCAM] = None
_deepface_available: Optional[bool] = None


def _get_model() -> Tuple[UIFrustrationModel, GradCAM]:
    """Lazy-load the EfficientNet-B0 frustration model and GradCAM."""
    global _frustration_model, _gradcam

    if _frustration_model is None:
        model_path = str(WEIGHTS_DIR / "best_model.pt")
        print(f"📥 Loading EfficientNet-B0 frustration model: {model_path}...")

        device = torch.device("cpu")
        model = UIFrustrationModel(pretrained=False)
        state = torch.load(model_path, map_location=device, weights_only=True)
        model.load_state_dict(state)
        model.eval()
        _frustration_model = model.to(device)
        _gradcam = GradCAM(_frustration_model)

        print("✅ EfficientNet-B0 + GradCAM loaded.")

    return _frustration_model, _gradcam


def _analyze_emotions_mobile(frame):
    """Run DeepFace emotion analysis on a single webcam frame."""
    global _deepface_available
    if _deepface_available is False:
        return None
    try:
        from deepface import DeepFace
        _deepface_available = True
        result = DeepFace.analyze(
            frame,
            actions=['emotion'],
            enforce_detection=False,
            silent=True
        )
        if result and len(result) > 0:
            return {
                "probabilities": result[0].get('emotion', {}),
                "dominant": result[0].get('dominant_emotion', 'neutral')
            }
    except (ImportError, ValueError) as e:
        print(f"⚠️ DeepFace unavailable: {e}")
        _deepface_available = False
    except Exception as e:
        print(f"⚠️ DeepFace analysis error: {e}")
    return None


def _compute_screen_motion(current_gray, prev_gray):
    """Compute normalized motion score between two grayscale frames."""
    if prev_gray is None:
        return 0.0
    diff = cv2.absdiff(prev_gray, current_gray)
    score = float(np.sum(diff)) / (224 * 224)
    return score


def _map_emotion_to_severity(emotion: str) -> str:
    if emotion in {"angry", "fear"}:
        return "high"
    elif emotion in {"sad", "disgust"}:
        return "medium"
    return "low"


def _format_timestamp(ms: float) -> str:
    seconds = ms / 1000
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}:{secs:04.1f}s"


def _generate_recommendations(emotion: str, frustration_prob: float) -> List[str]:
    """Generate recommendations based on emotion + frustration level."""
    recs = []

    emotion_recs = {
        "angry": [
            "Review the response time — users may feel this area is unresponsive",
            "Add clear visual feedback when the user interacts with this region"
        ],
        "fear": [
            "Add a confirmation dialog or undo option near this area",
            "Use clearer labeling to reduce user uncertainty"
        ],
        "sad": [
            "Review the user flow around this area for potential dead-ends",
            "Add helper text or tooltips to guide the user"
        ],
        "disgust": [
            "Review the visual design — color, spacing, and typography",
            "Consider A/B testing alternative layouts for this section"
        ]
    }

    if emotion in emotion_recs:
        recs.extend(emotion_recs[emotion])

    if frustration_prob > 0.8:
        recs.append("This region is a critical frustration hotspot — prioritize redesign")
    elif frustration_prob > 0.6:
        recs.append("Consider simplifying the layout in this region")

    return recs[:3]


# ---------------------------------------------------------------------------
# Main mobile analysis pipeline
# ---------------------------------------------------------------------------

def run_mobile_analysis(cam_path: str, screen_path: str) -> Dict[str, Any]:
    """
    Mobile frustration analysis pipeline.

    Uses EfficientNet-B0 + GradCAM instead of YOLO.
    Returns the same JSON schema as run_video_analysis() for frontend compatibility.
    """
    print(f"\n{'='*60}")
    print(f"📱 Starting Mobile Frustration Analysis...")
    print(f"   Webcam:  {cam_path}")
    print(f"   Screen:  {screen_path}")
    print(f"{'='*60}")

    model, gcam = _get_model()
    device = next(model.parameters()).device

    cap_cam = cv2.VideoCapture(cam_path)
    cap_scr = cv2.VideoCapture(screen_path)

    if not cap_cam.isOpened():
        return {"error": f"Cannot open webcam video: {cam_path}"}
    if not cap_scr.isOpened():
        return {"error": f"Cannot open screen video: {screen_path}"}

    fps = cap_scr.get(cv2.CAP_PROP_FPS)
    if fps == 0:
        fps = 30
    raw_frame_count = int(cap_scr.get(cv2.CAP_PROP_FRAME_COUNT))
    total_frames_label = raw_frame_count if raw_frame_count > 0 else "unknown"
    width = int(cap_scr.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap_scr.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Check DeepFace availability
    try:
        from deepface import DeepFace  # noqa: F401
        print("✅ DeepFace is available — emotion detection enabled.")
    except (ImportError, ValueError) as e:
        error_msg = f"DeepFace is not available: {e}. Install with: pip install deepface tf-keras"
        print(f"❌ {error_msg}")
        return {"error": error_msg}

    triggers = ['angry', 'disgust', 'fear', 'sad']

    timeline_data = []
    captured_screen_frames = []  # Screen frames captured at issue moments for Gemini Vision
    emotions_sum = {'angry': 0, 'disgust': 0, 'fear': 0, 'happy': 0,
                    'sad': 0, 'surprise': 0, 'neutral': 0}
    screen_motion_sum = 0.0
    valid_frames = 0
    prev_gray_scr = None
    frame_idx = 0
    unique_emotions = set()

    print(f"📊 Processing ~{total_frames_label} frames (sampling every 15th frame)...")

    while True:
        ret_s, frame_scr = cap_scr.read()
        if not ret_s:
            break

        current_time_ms = cap_scr.get(cv2.CAP_PROP_POS_MSEC)

        ret_c, frame_cam = cap_cam.read()

        if frame_idx % 15 == 0 and ret_c:
            try:
                # A. Emotion Analysis on webcam frame
                emotion_result = _analyze_emotions_mobile(frame_cam)

                if emotion_result:
                    dominant_emotion = emotion_result["dominant"]
                    probs = emotion_result["probabilities"]
                    conf = probs.get(dominant_emotion, 0)
                    print(f"   [Frame {frame_idx}] Emotion: {dominant_emotion} ({conf:.1f}%)")

                    for key in emotions_sum:
                        emotions_sum[key] += probs.get(key, 0)

                    # B. Screen Motion
                    gray_s = cv2.cvtColor(frame_scr, cv2.COLOR_BGR2GRAY)
                    gray_s = cv2.resize(gray_s, (224, 224))
                    motion = _compute_screen_motion(gray_s, prev_gray_scr)
                    screen_motion_sum += motion
                    prev_gray_scr = gray_s

                    valid_frames += 1

                    # C. If negative emotion → run EfficientNet + GradCAM
                    if dominant_emotion in triggers:
                        unique_emotions.add(dominant_emotion)
                        print(f"   🚩 Negative emotion '{dominant_emotion}' → running frustration model...")

                        # Preprocess screen frame for EfficientNet
                        pil_img = Image.fromarray(cv2.cvtColor(frame_scr, cv2.COLOR_BGR2RGB))
                        tensor = _preprocess(pil_img).unsqueeze(0).to(device)

                        # Get frustration probability
                        with torch.no_grad():
                            logit = model(tensor)
                            frust_prob = torch.sigmoid(logit).item()

                        print(f"   🧠 Frustration probability: {frust_prob:.0%}")

                        if frust_prob >= FRUSTRATION_THRESHOLD:
                            # Generate GradCAM heatmap
                            model.zero_grad()
                            cam_map = gcam.generate(tensor)

                            # Convert heatmap to bounding boxes
                            h_frame, w_frame = frame_scr.shape[:2]
                            boxes = _cam_to_bounding_boxes(cam_map, h_frame, w_frame)

                            for box in boxes:
                                event = {
                                    "frame": frame_idx,
                                    "timestamp_ms": round(current_time_ms, 2),
                                    "emotion": dominant_emotion,
                                    "ui_element": f"frustration_region ({frust_prob:.0%})",
                                    "bounding_box": box,
                                    "frustration_prob": round(frust_prob, 3),
                                }
                                timeline_data.append(event)
                                captured_screen_frames.append(frame_scr.copy())
                                print(f"   ⚠️ [{_format_timestamp(current_time_ms)}] "
                                      f"{dominant_emotion.upper()} → hotspot at "
                                      f"({box['x1']},{box['y1']})-({box['x2']},{box['y2']})")
                        else:
                            print(f"   ✅ Below threshold ({FRUSTRATION_THRESHOLD:.0%}), skipped")

            except Exception as e:
                print(f"   ⚠️ Frame {frame_idx} error: {e}")

        frame_idx += 1
        if frame_idx % 100 == 0:
            print(f"   📈 Processed {frame_idx}/{total_frames_label} frames...")

    cap_cam.release()
    cap_scr.release()

    # --- Build Summary ---
    total_frames = frame_idx
    duration_seconds = (total_frames / fps) if fps > 0 else 0
    events_detected = len(timeline_data)

    dominant_overall = max(emotions_sum, key=emotions_sum.get) if valid_frames > 0 else "neutral"

    negative_ratio = events_detected / max(valid_frames, 1)
    verdict = "FAIL" if negative_ratio > 0.1 else "PASS"
    confidence = min(100, max(50, int((1 - negative_ratio) * 100) if verdict == "PASS"
                              else int(negative_ratio * 100 + 50)))

    # --- Build Issues List ---
    issues = []
    issues_context = []  # Context dicts for Gemini advisor

    for i, event in enumerate(timeline_data):
        severity = _map_emotion_to_severity(event["emotion"])
        frust_prob = event.get("frustration_prob", 0.5)

        title_map = {
            "angry": "Frustration Hotspot",
            "fear": "User Uncertainty Zone",
            "sad": "Navigation Pain Point",
            "disgust": "Visual Discomfort Area"
        }

        issues.append({
            "id": i + 1,
            "severity": severity,
            "title": title_map.get(event["emotion"], "Frustration Hotspot"),
            "desc": (f"User showed '{event['emotion']}' emotion — model identified this "
                     f"UI region as a frustration trigger ({frust_prob:.0%} confidence)"),
            "timestamp_ms": event["timestamp_ms"],
            "time": _format_timestamp(event["timestamp_ms"]),
            "reaction": event["emotion"].capitalize(),
            "ui_element": event["ui_element"],
            "bounding_box": event["bounding_box"],
            "recommendations": []  # Will be filled by Gemini or fallback
        })

        issues_context.append({
            "emotion": event["emotion"],
            "ui_element": event["ui_element"],
            "bounding_box": event["bounding_box"],
            "timestamp_ms": event["timestamp_ms"],
            "frustration_prob": frust_prob,
        })

    # --- Generate recommendations via Gemini LLM (falls back to templates) ---
    from server.services.gemini_advisor import (
        generate_issue_recommendations,
        generate_overall_recommendations,
    )

    per_issue_recs = generate_issue_recommendations(
        issues_context, captured_screen_frames, platform="mobile"
    )
    for i, recs in enumerate(per_issue_recs):
        if i < len(issues):
            issues[i]["recommendations"] = recs

    all_recommendations = generate_overall_recommendations(
        issues_context, per_issue_recs, platform="mobile"
    )

    print(f"\n{'='*60}")
    print(f"✅ Mobile Analysis Complete!")
    print(f"   Verdict: {verdict} ({confidence}% confidence)")
    print(f"   Frustration events: {events_detected}")
    print(f"   Duration: {duration_seconds:.1f}s")
    print(f"{'='*60}\n")

    response = {
        "summary": {
            "verdict": verdict,
            "confidence": confidence,
            "total_issues": events_detected,
            "emotional_reactions": len(unique_emotions),
            "suggestions_count": len(all_recommendations),
            "dominant_emotion": dominant_overall,
            "screen_motion_avg": round(screen_motion_sum / max(valid_frames, 1), 2),
            "duration_seconds": round(duration_seconds, 1),
            "total_frames_analyzed": valid_frames
        },
        "issues": issues,
        "timeline": timeline_data,
        "recommendations": all_recommendations,
        "meta": {
            "platform": "mobile",
            "model": "EfficientNet-B0 + GradCAM",
            "cam_video": os.path.basename(cam_path),
            "screen_video": os.path.basename(screen_path),
            "total_frames": frame_idx,
            "fps": fps,
            "resolution": f"{width}x{height}"
        }
    }

    import json
    print("📤 Final Mobile Analysis Response:")
    print(json.dumps({
        "summary": response["summary"],
        "issues_count": len(response["issues"]),
        "first_issue_example": response["issues"][0] if response["issues"] else "None",
        "recommendations_count": len(response["recommendations"])
    }, indent=2))

    return response
"""
Video Analysis Service
Ported from Interactive video analyzer/test2.ipynb
Combines DeepFace emotion detection on webcam with YOLO UI element detection on screen.
"""
import os
import cv2
import numpy as np
from typing import Dict, Any, List
from ultralytics import YOLO

from server.config import WEIGHTS_DIR

# Lazy-loaded globals
_yolo_model = None
_deepface_available = None

def _get_yolo():
    """Lazy-load the YOLO model for UI element detection."""
    global _yolo_model
    if _yolo_model is None:
        model_path = str(WEIGHTS_DIR / "best.pt")
        print(f"📥 Loading YOLO model from {model_path}...")
        _yolo_model = YOLO(model_path)
    return _yolo_model


def _analyze_emotions(frame):
    """
    Run DeepFace emotion analysis on a single frame.
    Returns dict of emotion probabilities and dominant emotion, or None on failure.
    """
    global _deepface_available
    if _deepface_available is False:
        # Already determined DeepFace is not available; skip silently
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
        import traceback
        traceback.print_exc()
    return None


def _compute_screen_motion(current_gray, prev_gray):
    """Compute normalized motion score between two grayscale frames."""
    if prev_gray is None:
        return 0.0
    diff = cv2.absdiff(prev_gray, current_gray)
    score = float(np.sum(diff)) / (224 * 224)
    return score


def _generate_recommendations(emotion: str, ui_element: str) -> List[str]:
    """Generate contextual recommendations based on detected issue."""
    recs = []

    # Emotion-based recommendations
    emotion_recs = {
        "angry": [
            "Review the response time of this element — users may feel it's unresponsive",
            "Add clear visual feedback when the user interacts with this component"
        ],
        "fear": [
            "Consider adding a confirmation dialog or undo option near this element",
            "Use clearer labeling to reduce user uncertainty"
        ],
        "sad": [
            "Review the user flow around this element for potential dead-ends",
            "Add helper text or tooltips to guide the user"
        ],
        "disgust": [
            "Review the visual design of this element — color, spacing, and typography",
            "Consider A/B testing alternative layouts for this section"
        ]
    }

    if emotion in emotion_recs:
        recs.extend(emotion_recs[emotion])

    # UI element-based recommendations
    element_lower = ui_element.lower()
    if "button" in element_lower:
        recs.append("Ensure button size meets minimum 44×44px touch target (WCAG)")
    elif "input" in element_lower or "field" in element_lower:
        recs.append("Add clear input validation feedback and placeholder text")
    elif "text" in element_lower:
        recs.append("Verify text contrast ratio meets WCAG AA (4.5:1 minimum)")

    return recs[:3]  # Limit to 3 recommendations per issue


def _map_emotion_to_severity(emotion: str) -> str:
    """Map emotion to issue severity level."""
    high_emotions = {"angry", "fear"}
    medium_emotions = {"sad", "disgust"}
    if emotion in high_emotions:
        return "high"
    elif emotion in medium_emotions:
        return "medium"
    return "low"


def _format_timestamp(ms: float) -> str:
    """Convert milliseconds to human-readable timestamp."""
    seconds = ms / 1000
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}:{secs:04.1f}s"


def run_video_analysis(cam_path: str, screen_path: str) -> Dict[str, Any]:
    """
    Main analysis function. Ported from Interactive video analyzer/test2.ipynb Cell 6.

    Takes two video files:
    - cam_path: webcam recording (for emotion detection)
    - screen_path: screen recording (for UI element detection via YOLO)

    Returns structured JSON with:
    - summary (verdict, confidence, stats)
    - timeline (timestamped events)
    - issues (formatted for frontend display)
    """
    print(f"\n{'='*60}")
    print(f"🎬 Starting Video Analysis...")
    print(f"   Webcam:  {cam_path}")
    print(f"   Screen:  {screen_path}")
    print(f"{'='*60}")

    yolo = _get_yolo()

    cap_cam = cv2.VideoCapture(cam_path)
    cap_scr = cv2.VideoCapture(screen_path)

    if not cap_cam.isOpened():
        return {"error": f"Cannot open webcam video: {cam_path}"}
    if not cap_scr.isOpened():
        return {"error": f"Cannot open screen video: {screen_path}"}

    fps = cap_scr.get(cv2.CAP_PROP_FPS)
    if fps == 0:
        fps = 30
    # .webm files often return invalid frame counts from OpenCV;
    # we'll count frames manually and use this only for logging.
    raw_frame_count = int(cap_scr.get(cv2.CAP_PROP_FRAME_COUNT))
    total_frames_label = raw_frame_count if raw_frame_count > 0 else "unknown"
    width = int(cap_scr.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap_scr.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Check DeepFace availability upfront — fail fast if not available
    try:
        from deepface import DeepFace  # noqa: F401
        print("✅ DeepFace is available — emotion detection enabled.")
    except (ImportError, ValueError) as e:
        error_msg = (f"DeepFace is not available: {e}. "
                     f"Install with: pip install deepface tf-keras")
        print(f"❌ {error_msg}")
        return {"error": error_msg}

    # Negative emotion triggers
    triggers = ['angry', 'disgust', 'fear', 'sad']

    # Tracking data
    timeline_data = []
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

        # Read webcam frame SEQUENTIALLY (not seeking).
        # .webm files do not support random seeking with cv2.CAP_PROP_POS_MSEC,
        # which caused ret_c to always be False.
        ret_c, frame_cam = cap_cam.read()

        # Process every 15th frame (~0.5 seconds at 30fps)
        if frame_idx % 15 == 0 and ret_c:
            try:
                # A. Emotion Analysis on webcam frame
                emotion_result = _analyze_emotions(frame_cam)

                if emotion_result:
                    dominant_emotion = emotion_result["dominant"]
                    probs = emotion_result["probabilities"]
                    conf = probs.get(dominant_emotion, 0)
                    print(f"   [Frame {frame_idx}] Emotion detected: {dominant_emotion} (Conf: {conf:.2f}%)")

                    # Accumulate emotion probabilities for summary
                    for key in emotions_sum:
                        emotions_sum[key] += probs.get(key, 0)

                    # B. Screen Motion
                    gray_s = cv2.cvtColor(frame_scr, cv2.COLOR_BGR2GRAY)
                    gray_s = cv2.resize(gray_s, (224, 224))
                    motion = _compute_screen_motion(gray_s, prev_gray_scr)
                    screen_motion_sum += motion
                    prev_gray_scr = gray_s

                    valid_frames += 1

                    # C. If negative emotion → run YOLO on screen
                    if dominant_emotion in triggers:
                        unique_emotions.add(dominant_emotion)
                        print(f"   🚩 Triggering YOLO detection on screen due to negative emotion: {dominant_emotion}")
                        results = yolo(frame_scr, verbose=False, device='cpu')

                        for r in results:
                            if len(r.boxes) > 0:
                                box = r.boxes[0]  # Most confident detection
                                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                                cls_id = int(box.cls[0])
                                elem_name = yolo.names.get(cls_id, f"element_{cls_id}")
                                elem_conf = float(box.conf[0])
                                print(f"   🔍 YOLO Detection: {elem_name} @ ({int(x1)}, {int(y1)}) - Conf: {elem_conf:.2f}")

                                event = {
                                    "frame": frame_idx,
                                    "timestamp_ms": round(current_time_ms, 2),
                                    "emotion": dominant_emotion,
                                    "ui_element": elem_name,
                                    "bounding_box": {
                                        "x1": int(x1), "y1": int(y1),
                                        "x2": int(x2), "y2": int(y2)
                                    }
                                }
                                timeline_data.append(event)
                                print(f"   ⚠️ [{_format_timestamp(current_time_ms)}] "
                                      f"{dominant_emotion.upper()} → {event['ui_element']}")
                                break
                elif frame_idx % 150 == 0:
                    # Log periodically when emotion detection returns nothing
                    print(f"   [Frame {frame_idx}] No emotion detected (DeepFace returned None)")

            except Exception as e:
                print(f"   ⚠️ Frame {frame_idx} analysis error: {e}")
        elif frame_idx % 15 == 0 and not ret_c and frame_idx < 30:
            # Log webcam read failures early to help debug
            print(f"   ⚠️ [Frame {frame_idx}] Failed to read webcam frame (ret_c=False)")

        frame_idx += 1

        if frame_idx % 100 == 0:
            print(f"   📈 Processed {frame_idx}/{total_frames_label} frames...")

    cap_cam.release()
    cap_scr.release()

    # --- Build Summary ---
    total_frames = frame_idx  # Use actual counted frames
    duration_seconds = (total_frames / fps) if fps > 0 else 0
    events_detected = len(timeline_data)

    # Determine dominant emotion overall
    dominant_overall = max(emotions_sum, key=emotions_sum.get) if valid_frames > 0 else "neutral"

    # PASS/FAIL verdict (from pipeline 2)
    # If >30% of events show negative emotions → FAIL
    negative_ratio = events_detected / max(valid_frames, 1)
    verdict = "FAIL" if negative_ratio > 0.1 else "PASS"
    confidence = min(100, max(50, int((1 - negative_ratio) * 100) if verdict == "PASS"
                              else int(negative_ratio * 100 + 50)))

    # --- Build Issues List (for frontend) ---
    issues = []
    for i, event in enumerate(timeline_data):
        severity = _map_emotion_to_severity(event["emotion"])
        recs = _generate_recommendations(event["emotion"], event["ui_element"])

        title_map = {
            "angry": "Interaction Failure",
            "fear": "User Uncertainty",
            "sad": "Navigation Difficulty",
            "disgust": "Visual Discomfort"
        }

        issues.append({
            "id": i + 1,
            "severity": severity,
            "title": title_map.get(event["emotion"], "UI Issue"),
            "desc": (f"User showed '{event['emotion']}' emotion while interacting "
                     f"near '{event['ui_element']}' element"),
            "timestamp_ms": event["timestamp_ms"],
            "time": _format_timestamp(event["timestamp_ms"]),
            "reaction": event["emotion"].capitalize(),
            "ui_element": event["ui_element"],
            "bounding_box": event["bounding_box"],
            "recommendations": recs
        })

    # --- Generate overall suggestions ---
    all_recommendations = []
    seen_recs = set()
    for issue in issues:
        for rec in issue.get("recommendations", []):
            if rec not in seen_recs:
                all_recommendations.append(rec)
                seen_recs.add(rec)

    print(f"\n{'='*60}")
    print(f"✅ Analysis Complete!")
    print(f"   Verdict: {verdict} ({confidence}% confidence)")
    print(f"   Events: {events_detected}")
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
            "cam_video": os.path.basename(cam_path),
            "screen_video": os.path.basename(screen_path),
            "total_frames": frame_idx,
            "fps": fps,
            "resolution": f"{width}x{height}"
        }
    }
    
    print("📤 Final AI Analysis Response Body:")
    import json
    # Print summary and first issue as example to keep logs readable
    print(json.dumps({
        "summary": response["summary"],
        "issues_count": len(response["issues"]),
        "first_issue_example": response["issues"][0] if response["issues"] else "None",
        "recommendations_count": len(response["recommendations"])
    }, indent=2))
    
    return response

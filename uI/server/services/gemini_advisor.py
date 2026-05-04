"""
Gemini UI Advisor
=================
Uses Google Gemini Vision to generate contextual, AI-powered recommendations
for UI issues detected during user testing sessions.

Replaces the old template-based _generate_recommendations() approach with
LLM-generated suggestions that can actually "see" the screen frame.

Falls back to template-based recommendations when GEMINI_API_KEY is missing
or when the Gemini API call fails.
"""

import base64
import cv2
import numpy as np
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

from server.config import GEMINI_API_KEY

# ---------------------------------------------------------------------------
# Gemini client (lazy-loaded)
# ---------------------------------------------------------------------------

_gemini_client = None


def _get_client():
    """Lazy-load the Gemini client. Returns None if no API key."""
    global _gemini_client
    if _gemini_client is not None:
        return _gemini_client

    if not GEMINI_API_KEY:
        print("⚠️ GEMINI_API_KEY not set — LLM recommendations disabled, using templates.")
        return None

    try:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        print("✅ Gemini client initialized for UI recommendations.")
        return _gemini_client
    except Exception as e:
        print(f"⚠️ Failed to initialize Gemini client: {e}")
        return None


MODEL_NAME = "gemini-2.5-flash"

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a senior UX designer and usability expert analyzing a user interface \
during a live user testing session. You are reviewing screen frames that were \
captured at moments when the user displayed negative emotional reactions \
(detected via facial emotion analysis from their webcam feed).

Your job is to provide specific, actionable, and concise UI improvement \
recommendations based on what you see in the screenshot and the context provided.

Rules:
- Focus ONLY on the UI region described or highlighted
- Be specific to what you SEE in the screenshot — do not give generic advice
- Each recommendation should be a single actionable sentence
- Return recommendations as a JSON array of strings
- Limit to 3 recommendations per issue
"""

# ---------------------------------------------------------------------------
# Template-based fallbacks (moved from video_analyzer.py / frustration_analyzer.py)
# ---------------------------------------------------------------------------


def _template_recommendations_web(emotion: str, ui_element: str) -> List[str]:
    """Fallback: template-based recommendations for the web pipeline."""
    recs = []

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

    element_lower = ui_element.lower()
    if "button" in element_lower:
        recs.append("Ensure button size meets minimum 44×44px touch target (WCAG)")
    elif "input" in element_lower or "field" in element_lower:
        recs.append("Add clear input validation feedback and placeholder text")
    elif "text" in element_lower:
        recs.append("Verify text contrast ratio meets WCAG AA (4.5:1 minimum)")

    return recs[:3]


def _template_recommendations_mobile(emotion: str, frustration_prob: float) -> List[str]:
    """Fallback: template-based recommendations for the mobile pipeline."""
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
# Frame encoding helpers
# ---------------------------------------------------------------------------


def _encode_frame_to_base64(frame: np.ndarray) -> str:
    """Encode an OpenCV BGR frame to a base64 JPEG string."""
    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer).decode("utf-8")


# ---------------------------------------------------------------------------
# Core LLM recommendation functions
# ---------------------------------------------------------------------------


def generate_issue_recommendations(
    issues_context: List[Dict[str, Any]],
    screen_frames: List[Optional[np.ndarray]],
    platform: str = "web",
) -> List[List[str]]:
    """
    Generate per-issue recommendations using Gemini Vision.

    Args:
        issues_context: List of dicts, each with keys:
            - emotion (str): detected emotion e.g. "angry"
            - ui_element (str): detected UI element name
            - bounding_box (dict): {x1, y1, x2, y2}
            - timestamp_ms (float): when the issue occurred
            - frustration_prob (float, optional): mobile only
        screen_frames: Corresponding screen frame (OpenCV BGR) for each issue,
                       or None if not available
        platform: "web" or "mobile"

    Returns:
        List of recommendation lists (one per issue). Each inner list
        contains 1-3 recommendation strings.
    """
    if not issues_context:
        return []

    client = _get_client()

    # Fallback if Gemini is unavailable
    if client is None:
        return _fallback_recommendations(issues_context, platform)

    try:
        return _call_gemini_for_issues(client, issues_context, screen_frames, platform)
    except Exception as e:
        print(f"⚠️ Gemini API call failed: {e} — falling back to templates.")
        return _fallback_recommendations(issues_context, platform)


def generate_overall_recommendations(
    issues_context: List[Dict[str, Any]],
    per_issue_recs: List[List[str]],
    platform: str = "web",
) -> List[str]:
    """
    Generate consolidated overall recommendations for the full session.

    Args:
        issues_context: Same as generate_issue_recommendations
        per_issue_recs: The per-issue recommendations already generated
        platform: "web" or "mobile"

    Returns:
        List of 3-5 overall recommendation strings.
    """
    if not issues_context:
        return []

    client = _get_client()

    if client is None:
        # Fallback: deduplicate per-issue recs
        return _dedup_recommendations(per_issue_recs)

    try:
        return _call_gemini_for_overall(client, issues_context, per_issue_recs, platform)
    except Exception as e:
        print(f"⚠️ Gemini overall recommendations failed: {e} — using dedup fallback.")
        return _dedup_recommendations(per_issue_recs)


# ---------------------------------------------------------------------------
# Internal: Gemini API calls
# ---------------------------------------------------------------------------


def _call_gemini_for_issues(
    client,
    issues_context: List[Dict[str, Any]],
    screen_frames: List[Optional[np.ndarray]],
    platform: str,
) -> List[List[str]]:
    """Send a batched prompt to Gemini for all issues in one call."""
    print(f"🤖 Requesting Gemini recommendations for {len(issues_context)} issue(s)...")

    # Build the per-issue descriptions
    issue_descriptions = []
    for i, ctx in enumerate(issues_context):
        desc = (
            f"Issue {i + 1}:\n"
            f"  - User emotion: {ctx.get('emotion', 'unknown')}\n"
            f"  - UI element: {ctx.get('ui_element', 'unknown')}\n"
            f"  - Bounding box: {ctx.get('bounding_box', {})}\n"
            f"  - Timestamp: {ctx.get('timestamp_ms', 0):.0f}ms\n"
        )
        if "frustration_prob" in ctx:
            desc += f"  - Frustration probability: {ctx['frustration_prob']:.0%}\n"
        issue_descriptions.append(desc)

    prompt = (
        f"Platform: {platform}\n"
        f"Total issues found: {len(issues_context)}\n\n"
        + "\n".join(issue_descriptions)
        + "\n\nFor EACH issue above, provide exactly 3 specific, actionable "
        "UI improvement recommendations based on the emotion, the UI element, "
        "and what you can see in the screenshot (if provided).\n\n"
        "Return your response as a valid JSON array of arrays. "
        "The outer array has one entry per issue, each entry is an array of "
        "3 recommendation strings. Example:\n"
        '[[\"rec1\", \"rec2\", \"rec3\"], [\"rec1\", \"rec2\", \"rec3\"]]\n\n'
        "Return ONLY the JSON array, no other text."
    )

    # Build content parts: text + up to 4 screen frames
    content_parts = [prompt]

    frames_to_send = [f for f in screen_frames if f is not None][:4]
    for frame in frames_to_send:
        b64 = _encode_frame_to_base64(frame)
        content_parts.append(
            types.Part.from_bytes(
                data=base64.b64decode(b64),
                mime_type="image/jpeg",
            )
        )

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=content_parts,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7,
            max_output_tokens=8192,
        ),
    )

    text = response.text.strip()
    print(f"   ✅ Gemini response received ({len(text)} chars)")
    print(f"   🔍 Raw Gemini response: {text}") 

    # Parse JSON response
    recs = _parse_json_array(text, len(issues_context))
    return recs


def _call_gemini_for_overall(
    client,
    issues_context: List[Dict[str, Any]],
    per_issue_recs: List[List[str]],
    platform: str,
) -> List[str]:
    """Ask Gemini for 3-5 consolidated recommendations across all issues."""
    print("🤖 Requesting Gemini overall session recommendations...")

    # Build summary of all issues and their recs
    summary_parts = []
    for i, (ctx, recs) in enumerate(zip(issues_context, per_issue_recs)):
        part = (
            f"Issue {i + 1}: {ctx.get('emotion', 'unknown')} emotion at "
            f"{ctx.get('ui_element', 'unknown')} "
            f"(timestamp: {ctx.get('timestamp_ms', 0):.0f}ms)\n"
            f"  Recommendations: {recs}\n"
        )
        summary_parts.append(part)

    prompt = (
        f"Platform: {platform}\n"
        f"Here are all the issues found during this user testing session:\n\n"
        + "\n".join(summary_parts)
        + "\n\nBased on ALL these issues, provide a consolidated list of the "
        "TOP 3-5 most critical and actionable UI improvement recommendations "
        "for the overall session. Prioritize by severity and frequency.\n\n"
        "Return your response as a JSON array of strings. Example:\n"
        '[\"recommendation 1\", \"recommendation 2\", \"recommendation 3\"]\n\n'
        "Return ONLY the JSON array, no other text."
    )

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[prompt],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7,
            max_output_tokens=1024,
        ),
    )

    text = response.text.strip()
    print(f"   ✅ Gemini overall response received ({len(text)} chars)")

    import json
    # Strip markdown code fences if present
    cleaned = text
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[:-1])
    cleaned = cleaned.strip()

    try:
        result = json.loads(cleaned)
        if isinstance(result, list) and all(isinstance(r, str) for r in result):
            return result[:5]
    except json.JSONDecodeError:
        pass

    print("   ⚠️ Could not parse overall recommendations JSON, using dedup fallback.")
    return _dedup_recommendations(per_issue_recs)


# ---------------------------------------------------------------------------
# Internal: Helpers
# ---------------------------------------------------------------------------


def _parse_json_array(text: str, expected_count: int) -> List[List[str]]:
    import json
    import re

    # Strip markdown code fences
    cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip()).strip()

    # Attempt 1: parse as-is
    try:
        result = json.loads(cleaned)
        if isinstance(result, list):
            normalized = []
            for entry in result:
                if isinstance(entry, list):
                    normalized.append([str(r) for r in entry[:3]])
                elif isinstance(entry, str):
                    normalized.append([entry])
                else:
                    normalized.append([])
            while len(normalized) < expected_count:
                normalized.append([])
            return normalized[:expected_count]
    except json.JSONDecodeError:
        pass

    # Attempt 2: extract whatever complete inner arrays exist
    print("   ⚠️ Full parse failed, extracting partial results...")
    pattern = r'\[([^\[\]]+)\]'
    matches = re.findall(pattern, cleaned)
    normalized = []
    for match in matches:
        try:
            items = json.loads(f"[{match}]")
            normalized.append([str(r) for r in items[:3]])
        except json.JSONDecodeError:
            continue
    while len(normalized) < expected_count:
        normalized.append([])
    return normalized[:expected_count]


def _fallback_recommendations(
    issues_context: List[Dict[str, Any]],
    platform: str,
) -> List[List[str]]:
    """Generate template-based recommendations as fallback."""
    results = []
    for ctx in issues_context:
        emotion = ctx.get("emotion", "neutral")
        if platform == "mobile":
            frust_prob = ctx.get("frustration_prob", 0.5)
            results.append(_template_recommendations_mobile(emotion, frust_prob))
        else:
            ui_element = ctx.get("ui_element", "unknown")
            results.append(_template_recommendations_web(emotion, ui_element))
    return results


def _dedup_recommendations(per_issue_recs: List[List[str]]) -> List[str]:
    """Deduplicate per-issue recommendations into a flat list."""
    seen = set()
    result = []
    for recs in per_issue_recs:
        for rec in recs:
            if rec not in seen:
                result.append(rec)
                seen.add(rec)
    return result
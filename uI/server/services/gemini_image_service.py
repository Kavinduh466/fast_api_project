"""
Gemini Native Image Generation Service
=======================================
Generates an enhanced UI image using Gemini's image generation model.
Takes the original UI screenshot + a design prompt as inputs.
"""

import base64
import io
import uuid
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

from server.config import GEMINI_API_KEY, UPLOAD_DIR

client = genai.Client(api_key=GEMINI_API_KEY)


def generate_enhanced_ui(prompt: str, reference_image_path: str) -> dict:
    """
    Generate an enhanced UI image using Gemini image generation.

    Args:
        prompt: Design improvement prompt from the feedback pipeline.
        reference_image_path: Path to the original UI screenshot.

    Returns:
        dict with 'image_url' on success, or 'error' on failure.
    """
    try:
        ref_image = Image.open(reference_image_path)

        # Wrap the design prompt with Gemini-specific image generation instructions
        enhanced_prompt = f"""You are an expert UI/UX designer. I'm providing a UI screenshot that needs to be redesigned and enhanced.

CRITICAL RULES:
- Generate a NEW, IMPROVED version of this EXACT UI — same screen type, same purpose, same content structure
- Output must be a clean, pixel-perfect UI screenshot — NOT a wireframe, NOT a mockup sketch, NOT abstract art
- The result should look like a real production application screenshot
- Maintain the same aspect ratio and approximate dimensions as the original
- Keep all text content readable and properly sized
- Use sharp, clean rendering — no blur, no artifacts, no watermarks

DESIGN DIRECTION:
{prompt}

Generate the enhanced version of this UI now. Output ONLY the redesigned UI image."""

        response = client.models.generate_content(
            model="gemini-3.1-flash-image-preview",
            contents=[enhanced_prompt, ref_image],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"]
            ),
        )

        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                raw = part.inline_data.data
                # SDK may return raw bytes or base64 string depending on version
                if isinstance(raw, (bytes, bytearray)):
                    image_data = raw
                else:
                    image_data = base64.b64decode(raw)
                buf = io.BytesIO(image_data)
                buf.seek(0)
                img = Image.open(buf)
                img.load()  # force decode before BytesIO goes out of scope

                filename = f"{uuid.uuid4().hex[:8]}_gemini_enhanced.png"
                save_path = Path(UPLOAD_DIR) / filename
                img.save(str(save_path), "PNG")

                return {"image_url": f"/uigen/image/{filename}"}

        return {"error": "Gemini returned no image in the response."}

    except Exception as e:
        print(f"[Gemini Image Gen] Error: {e}")
        return {"error": str(e)}

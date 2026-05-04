"""
Test script for the /audit/smart endpoint.
Sends a test image from SMARTUI_RL to the running server and saves the JSON response.

Usage:
    python test_audit_endpoint.py
"""

import requests
import json
import os

SERVER_URL = "http://localhost:8000"
TEST_IMAGE = os.path.join("SMARTUI_RL", "test1.png")  # Change to test1.jpg or tes3.png if needed
OUTPUT_JSON = "test_audit_output.json"

def test_smart_audit():
    if not os.path.exists(TEST_IMAGE):
        print(f"❌ Test image not found: {TEST_IMAGE}")
        return

    print(f"📤 Sending '{TEST_IMAGE}' to {SERVER_URL}/audit/smart ...")

    with open(TEST_IMAGE, "rb") as img_file:
        files = {"file": (os.path.basename(TEST_IMAGE), img_file, "image/png")}
        data = {"profile": "universal"}

        response = requests.post(f"{SERVER_URL}/audit/smart", files=files, data=data)

    print(f"📥 Status Code: {response.status_code}")

    if response.status_code == 200:
        result = response.json()
        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=4)
        print(f"✅ Response saved to '{OUTPUT_JSON}'")
        print(f"   Score: {result.get('summary', {}).get('score')}")
        print(f"   Violations: {result.get('summary', {}).get('violations')}")
        print(f"   Elements: {len(result.get('elements', []))}")
    else:
        print(f"❌ Error: {response.text}")

if __name__ == "__main__":
    test_smart_audit()

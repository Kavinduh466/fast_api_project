import cv2
from ultralytics import YOLO
import json
import os
import time
import PIL.Image
from google import genai

# --- CONFIGURATION ---
API_KEY = "AIzaSyB-pBHMJvjVavek-HlO3JyFTELHLYq-M7Q" 
YOLO_MODEL = "best.pt"
JSON_FILE = "audit_result.json"
UI_IMAGE = "ui_input1.jpeg"
OUT_1, OUT_2, OUT_3 = "output_phase1_technical.jpg", "output_phase2_aesthetic.jpg", "output_phase3_synthesis.jpg"

client = genai.Client(api_key=API_KEY)

# --- HELPER FUNCTIONS (Defined FIRST to avoid NameError) ---

def draw_exact_format(img, bbox, error_text, fix_text):
    """Draws Red/Green boxes and labels on the image."""
    x1, y1, x2, y2 = map(int, bbox)
    img_h, img_w = img.shape[:2]
    RED, GREEN, WHITE = (0, 0, 255), (0, 150, 0), (255, 255, 255)
    
    # 1. Boxes
    cv2.rectangle(img, (x1, y1), (x2, y2), RED, 4)
    cv2.rectangle(img, (x1 + 6, y1 + 6), (x2 - 6, y2 - 6), GREEN, 2)

    # 2. Labels
    def put_label(label, x, y, bg_color, is_top):
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        draw_y = (y - 10) if is_top else (y + h + 10)
        cv2.rectangle(img, (x, draw_y - h - 5), (x + w + 5, draw_y + 5), bg_color, -1)
        cv2.putText(img, label, (x + 2, draw_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, WHITE, 2)

    if error_text: put_label(f"ERR: {error_text}", x1, y1, RED, is_top=True)
    if fix_text: put_label(f"FIX: {fix_text}", x1, y2, GREEN, is_top=False)

def ask_gemini(prompt, img_path):
    """Sends request to Gemini with a safety delay to avoid 429 errors."""
    try:
        time.sleep(4) # ⏳ THROTTLING: Stay under 10 requests per minute
        img = PIL.Image.open(img_path)
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=[prompt, img]
        )
        return response.text.strip().replace('"', '').replace("'", "")[:30]
    except Exception as e:
        print(f"Gemini Error: {e}")
        return "Optimize Design"

# --- NEW HELPER: For generating the long prompt without cutting text ---
def get_full_response(prompt, img_path):
    try:
        time.sleep(2)
        img = PIL.Image.open(img_path)
        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=[prompt, img]
        )
        return response.text.strip() # No slicing!
    except Exception as e:
        return "Modern UI Interface"

# --- MAIN PIPELINE ---

def run_pipeline():
    print(" Starting Gemini Multi-Phase Audit...")
    
    # 1. Load Model & Image
    try:
        model = YOLO(YOLO_MODEL)
    except:
        model = YOLO("yolov8n.pt")

    img_raw = cv2.imread(UI_IMAGE)
    if img_raw is None:
        print(f" {UI_IMAGE} not found!")
        return

    img_p1, img_p2, img_p3 = img_raw.copy(), img_raw.copy(), img_raw.copy()
    processed_bboxes = [] # Safety Net
    
    # [ADDED] List to collect issues for the final prompt
    collected_issues = []

    def is_duplicate(new_box, threshold=40):
        for box in processed_bboxes:
            if all(abs(new_box[i] - box[i]) < threshold for i in range(4)):
                return True
        return False

    # --- PHASE 1: TECHNICAL (JSON + RAW UI) ---
    print(" Phase 1: Technical")
    if os.path.exists(JSON_FILE):
        with open(JSON_FILE, 'r') as f:
            data = json.load(f)
            elements = data.get('elements', [])
            failures = [el for el in elements if el.get('status') == 'FAIL']
        
        for v in failures[:5]: 
            # 1. Safety Check for 'bbox'
            if 'bbox' not in v:
                print(f" Skipping ID {v.get('id')}: No bbox coordinates.")
                continue
            
            # 2. Safety Check for 'issues' and 'desc' (Your JSON uses 'desc')
            issues = v.get('issues', [])
            if not issues or 'desc' not in issues[0]:
                raw_err = "General UI Failure"
            else:
                raw_err = issues[0]['desc'] # Changed from 'description' to 'desc'
            
            bbox = v['bbox']
            print(f"   Analyzing Technical: {raw_err}...")
            
            prompt = f"How to fix this UI element? Issue: {raw_err}. Max 3 words."
            fix_short = ask_gemini(prompt, UI_IMAGE)
            
            # [ADDED] Store issue
            collected_issues.append(f"- Fix technical error: '{raw_err}' by applying: '{fix_short}'")
            
            draw_exact_format(img_p1, bbox, "Tech Err", fix_short)
            draw_exact_format(img_p3, bbox, "Tech Err", fix_short)
            processed_bboxes.append(bbox)
            
    # --- PHASE 2: AESTHETIC (ANNOTATED UI + RAW UI) ---
    print("Phase 2: Aesthetic")
    results = model(UI_IMAGE)
    temp_annotated = "temp_annotated.jpg"
    cv2.imwrite(temp_annotated, results[0].plot()) 
    
    count = 0
    for box in results[0].boxes.xyxy.cpu().numpy():
        if count >= 3: break # Cap requests
        if is_duplicate(box): continue 
        
        prompt = "Look at this annotated UI box. Suggest one style/spacing fix. Max 3 words."
        fix_short = ask_gemini(prompt, temp_annotated)
        
        # [ADDED] Store issue
        collected_issues.append(f"- Improve aesthetics: {fix_short}")
        
        draw_exact_format(img_p2, box, "Style", fix_short)
        draw_exact_format(img_p3, box, "Aesthetic", fix_short) # Combined
        processed_bboxes.append(box)
        count += 1

    # --- PHASE 3: SYNTHESIS (FULL CONTEXT) ---
    print(" Phase 3: Synthesis")
    final_prompt = "Combine technical failures and visual layout. What is the top UX priority? Max 4 words."
    synthesis_msg = ask_gemini(final_prompt, temp_annotated)
    
    # Draw Synthesis Header on P3
    cv2.rectangle(img_p3, (0,0), (img_p3.shape[1], 60), (150, 0, 0), -1)
    cv2.putText(img_p3, f"SYNTHESIS: {synthesis_msg}", (20, 40), 
                cv2.FONT_HERSHEY_SIMPLEX, 1, (255,255,255), 2)

    # Save Outputs
    cv2.imwrite(OUT_1, img_p1)
    cv2.imwrite(OUT_2, img_p2)
    cv2.imwrite(OUT_3, img_p3)
    print(f" DONE. Report saved as {OUT_3}")

    # --- PHASE 4: GENERATE IMAGE PROMPT (NEW) ---
    print("✨ Generating Generator Prompt...")
    
    issues_text = "\n".join(collected_issues)
    
    prompt_req = f"""
    You are an expert Prompt Engineer for Midjourney and Stable Diffusion.
    I have a UI interface (attached) that has these specific flaws:
    {issues_text}
    
    The main goal is: {synthesis_msg}
    
    Write a detailed text-to-image prompt to generate a fixed, high-quality version of this UI.
    Include specific details on:
    1. Modern clean layout (solving the clutter).
    2. Color palette and Typography.
    3. Correcting the specific technical errors listed above.
    
    Return ONLY the prompt string.
    """
    
    # Using the new helper function to get the full length text
    final_prompt_text = get_full_response(prompt_req, UI_IMAGE)
    
    with open("generator_prompt.txt", "w") as f:
        f.write(final_prompt_text)
        
    print(" Prompt saved to 'generator_prompt.txt'")

if __name__ == "__main__":
    run_pipeline()
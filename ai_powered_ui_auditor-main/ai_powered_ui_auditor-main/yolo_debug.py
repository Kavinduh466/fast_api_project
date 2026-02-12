import os
from ultralytics import YOLO

# Path to the model and a test image
model_path = "/Users/binurasenevirathna/Projects/ai_powerd_ui_editr/ai_powered_ui_auditor/SMARTUI_RL/ui_model.pt"
image_path = "/Users/binurasenevirathna/Projects/ai_powerd_ui_editr/ai_powered_ui_auditor/SMARTUI_RL/test1.png"

if not os.path.exists(model_path):
    print(f"Error: Model not found at {model_path}")
elif not os.path.exists(image_path):
    print(f"Error: Image not found at {image_path}")
else:
    print(f"--- YOLO Debug Start ---")
    print(f"Loading model: {model_path}")
    model = YOLO(model_path)
    print(f"Model loaded successfully.")
    
    print(f"Running inference on: {image_path}")
    results = model(image_path, conf=0.15)
    print(f"Inference complete.")
    
    if results:
        print(f"Detected {len(results[0].boxes)} elements.")
        for i, box in enumerate(results[0].boxes):
            print(f"  [{i}] Class: {int(box.cls[0])}, Conf: {float(box.conf[0]):.2f}")
    
    print(f"--- YOLO Debug End ---")

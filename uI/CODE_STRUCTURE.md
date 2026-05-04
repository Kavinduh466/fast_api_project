# Code Structure Documentation

## Overview

This is a **UI/UX AI Auditor System** that analyzes UI screenshots and videos to detect design violations, provide feedback, and generate improvement suggestions. The system consists of a FastAPI backend server and a SMARTUI_RL module with Reinforcement Learning capabilities.

---

## Directory Structure

```
/
├── server/                    # FastAPI backend
│   ├── main.py               # App entry point
│   ├── config.py             # Configuration & paths
│   ├── routers/              # API route handlers
│   ├── services/             # Business logic
│   ├── schemas/              # Pydantic models
│   ├── weights/              # ML model files
│   └── uploads/              # Uploaded files storage
│
├── SMARTUI_RL/               # AI Auditing with RL
│   ├── auditor_service.py    # Main audit pipeline
│   ├── rule_engine.py        # Profile-based rule loading
│   ├── rl_feedback.py        # RL feedback learning
│   ├── audit_utils.py        # OCR, contrast analysis
│   ├── metrics_tracker.py    # Audit metrics
│   └── ui_model.pt           # YOLO model
│
└── UI_RULE_SETS.xlsx         # Design rules per profile
```

---

## Server Component

### `server/main.py`
- **Purpose**: FastAPI application entry point
- **Tasks**:
  - Initialize FastAPI app with CORS middleware
  - Register all routers (audit, health, feedback, export, video-analysis, uigen)
  - Ensure upload directory exists on startup

### `server/config.py`
- **Purpose**: Central configuration
- **Tasks**:
  - Load environment variables from `.env`
  - Define paths: `UPLOAD_DIR`, `WEIGHTS_DIR`, `SMARTUI_RL_DIR`
  - Load `GEMINI_API_KEY`
  - Provide `ensure_upload_dir()` function

---

## API Routers (`server/routers/`)

| File | Endpoints | Tasks |
|------|-----------|-------|
| `audit.py` | `/audit`, `/audit/smart`, `/audit/report/{id}` | Classic & AI-powered UI audit |
| `health.py` | `/health` | Health check |
| `feedback.py` | `/audit/feedback`, `/audit/feedback/batch` | RL feedback submission |
| `export.py` | `/audit/export` | Generate Markdown reports |
| `feedback_generator.py` | `/feedback/generate`, `/feedback/report/{id}` | 3-phase Gemini feedback |
| `uigen_auditor.py` | `/uigen/generate`, `/uigen/image/{file}` | 6-phase UIGen pipeline |
| `video_analysis.py` | `/video-analysis/analyze` | User testing video analysis |

---

## Services (`server/services/`)

### `auditor.py`
- **Purpose**: Classic audit using YOLO + CLIP + FAISS
- **Tasks**:
  1. Detect UI components with YOLOv8
  2. Vectorize each crop with CLIP
  3. Search FAISS index for nearest expert match
  4. Color-code results (green/orange/red)
  5. Generate annotated report image

### `smartui_auditor.py`
- **Purpose**: Wrapper for SMARTUI_RL audit
- **Tasks**:
  - Call `run_smart_audit()` from SMARTUI_RL
  - Transform results to frontend-compatible format

### `detector.py`
- **Purpose**: YOLO model loader
- **Tasks**: Lazy-load YOLO model on first use

### `vectorizer.py`
- **Purpose**: CLIP image embedding
- **Tasks**: Convert image crops to 512-dim feature vectors

### `report_service.py`
- **Purpose**: Markdown report generation
- **Tasks**: Convert audit results to formatted Markdown

### `feedback_generator.py`
- **Purpose**: Multi-phase Gemini feedback
- **Tasks**:
  - Phase 1: Technical fixes from audit JSON
  - Phase 2: Aesthetic improvements (YOLO + Gemini)
  - Phase 3: Synthesis of findings
  - Phase 4: Text-to-image prompt generation

### `uigen_auditor.py`
- **Purpose**: 6-phase UI generation pipeline
- **Tasks**:
  - Phase 1: Screenshot + JSON → Gemini error suggestions
  - Phase 2: Scored image → Gemini improvements
  - Phase 3: Cross-analysis → Gemini suggestions
  - Phase 5: Design prompt generation
  - Phase 6: AI-generated improved UI (Gemini/Imagen/Pollinations)

### `video_analyzer.py`
- **Purpose**: User testing video analysis (Web platform)
- **Tasks**:
  - DeepFace emotion detection on webcam
  - YOLO UI element detection on screen
  - Generate timeline of negative emotions → UI elements
  - Recommendations based on emotion + element

### `frustration_analyzer.py`
- **Purpose**: Mobile frustration analysis
- **Tasks**:
  - EfficientNet-B0 frustration classifier
  - GradCAM heatmap generation
  - Identify frustration hotspots in UI

---

## SMARTUI_RL Component

### `auditor_service.py`
- **Purpose**: Main SMARTUI_RL audit pipeline
- **Tasks**:
  1. **YOLO Detection**: Detect UI elements
  2. **Deep Inspection**: OCR (EasyOCR), Colors (K-Means), Contrast (WCAG)
  3. **Math Rule Check**: Validate button heights, field sizes, alignment
  4. **Violet Rules**: LLM evaluates text-based design principles
  5. **LLM Consultation**: AI analysis and recommendations
  6. **RL Integration**: Filter violations based on user feedback

### `rule_engine.py`
- **Purpose**: Profile-based rule loading from Excel
- **Tasks**:
  - Load Excel sheets per profile (Apple HIG, Material, Healthcare, etc.)
  - Parse math rules (button height, field height, alignment)
  - Parse text rules (design principles)
  - Provide defaults if Excel unavailable

### `rl_feedback.py`
- **Purpose**: Reinforcement Learning feedback system
- **Tasks**:
  - Store strictness weights per rule in memory
  - `should_flag_violation()`: Filter rules with weight < 0.4
  - `update_policy()`: Adjust weights based on user feedback (+1/-1)
  - Persist to `rl_memory.json`

### `audit_utils.py`
- **Purpose**: Element content analysis
- **Tasks**:
  - `analyze_element_content()`: OCR + color extraction + contrast calculation
  - `get_contrast_ratio()`: WCAG 2.1 formula
  - Lazy-load EasyOCR reader

### `metrics_tracker.py`
- **Purpose**: Audit performance tracking
- **Tasks**:
  - Track false positive rate, accuracy per run
  - Calculate improvement metrics over time
  - Save metrics to JSON

---

## ML Models & Assets

| File | Type | Purpose |
|------|------|---------|
| `weights/best.pt` | YOLOv8 | Classic audit element detection |
| `weights/best3.pt` | YOLOv8 | Feedback generator detection |
| `weights/best4.pt` | YOLOv8 | Video analysis web detection |
| `weights/best_model.pt` | EfficientNet-B0 | Mobile frustration classifier |
| `SMARTUI_RL/ui_model.pt` | YOLO | SMARTUI_RL element detection |
| `SMARTUI_RL/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` | LLM | Violet rule evaluation |
| `expert_style_index.bin` | FAISS | Similarity search index |
| `image_paths.txt` | Text | Expert image paths for FAISS |
| `SMARTUI_RL/UI_RULE_SETS.xlsx` | Excel | Design rules per profile |

---

## Data Flow

```
User Upload (Image/Video)
        │
        ▼
   FastAPI Router
        │
        ▼
   Service Layer
        │
        ├────► SMARTUI_RL (AI Audit)
        │           │
        │           ▼
        │     RuleEngine (Excel)
        │           │
        │           ▼
        │     YOLO Detection
        │           │
        │           ▼
        │     Math Rules + Violet Rules
        │           │
        │           ▼
        │     RL Feedback Filter
        │           │
        │           ▼
        │     LLM Analysis
        │
        ├────► Classic Audit (YOLO + CLIP + FAISS)
        │
        ├────► Feedback Generator (Gemini)
        │
        ├────► UIGen Pipeline (Gemini/Imagen)
        │
        └────► Video Analysis (DeepFace + YOLO/EfficientNet)

        │
        ▼
   Response (JSON/Image)
```

---

## Dependencies

- **FastAPI** - Web framework
- **Ultralytics** - YOLO models
- **CLIP** - Image embeddings
- **FAISS** - Similarity search
- **EasyOCR** - Text recognition
- **DeepFace** - Emotion detection
- **PyTorch** - ML backend
- **Gemini API** - LLM analysis & image generation
- **OpenCV** - Image processing
- **Pandas** - Excel reading
- **ctransformers** - GGUF LLM inference

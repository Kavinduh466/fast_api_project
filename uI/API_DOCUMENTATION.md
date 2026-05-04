# API Documentation

## Base URL
```
http://localhost:8000
```

---

## Health Check

### GET /health

Check server health status.

**Response**
```json
{
  "status": "ok"
}
```

**Status Code**: `200 OK`

---

## UI Audit Endpoints

### POST /audit

Classic UI audit using YOLO + CLIP + FAISS similarity search.

**Request**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File | Yes | UI screenshot image (PNG/JPG) |

**Response**
```json
{
  "report_id": "7f68a975",
  "overall_score": 75.5,
  "grade": "GOOD",
  "total_components": 5,
  "components": [
    {
      "class": "button",
      "confidence": 0.892,
      "bbox": [100, 200, 250, 280],
      "similarity_score": 82.5,
      "matched_expert": "submit_btn.png"
    }
  ],
  "report_image_url": "/audit/report/7f68a975"
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid file
- `500 Internal Server Error` - Processing error

---

### POST /audit/smart

AI-powered UI audit using SMARTUI_RL with RL feedback.

**Request**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File | Yes | UI screenshot image (PNG/JPG) |
| `profile` | Query | No | Design profile (default: `universal`) |

Supported profiles: `apple`, `ios`, `google`, `material`, `android`, `microsoft`, `fluent`, `healthcare`, `ecommerce`, `gaming`, `enterprise`, `b2b`, `web`, `universal`

**Response**
```json
{
  "meta": {
    "profile": "universal",
    "timestamp": "2026-03-17T10:30:00"
  },
  "summary": {
    "score": 70,
    "violations": 3
  },
  "violations": [
    {
      "id": 1,
      "rule": "min_button_height",
      "title": "Button Size Check",
      "description": "Button 'Submit' is too small (32px vs 44px).",
      "violated": true,
      "element_info": {
        "type": "button",
        "bbox": [100, 200, 200, 240],
        "content": "Submit"
      }
    }
  ],
  "elements": [
    {
      "id": 0,
      "type": "button",
      "cls_id": 1,
      "bbox": [100, 200, 200, 240],
      "content": {
        "text": "Submit",
        "contrast": 4.2,
        "bg_color": [255, 255, 255],
        "fg_color": [0, 0, 0]
      },
      "issues": [...],
      "status": "FAIL"
    }
  ],
  "llm_analysis": "The button size violation reduces touch target accessibility..."
}
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - AI processing error

---

### GET /audit/report/{report_id}

Get annotated report image.

**Response**

Returns JPEG image file.

**Status Codes**:
- `200 OK` - Image found
- `404 Not Found` - Report not found

---

## Feedback Endpoints

### POST /audit/feedback

Submit RL feedback for a rule violation.

**Request**
```json
{
  "profile": "universal",
  "rule_name": "min_button_height",
  "feedback": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | Profile name (e.g., `universal`) |
| `rule_name` | string | Rule identifier (e.g., `min_button_height`) |
| `feedback` | integer | `+1` = agree (good catch), `-1` = disagree (ignore) |

**Response**
```json
{
  "status": "success",
  "message": "Policy updated. Rule 'min_button_height' Strengthened (Weight: 1.20)"
}
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - Processing error

---

### POST /audit/feedback/batch

Submit batch RL feedback for multiple rules.

**Request**
```json
{
  "profile": "universal",
  "items": [
    {"rule_name": "min_button_height", "feedback": 1},
    {"rule_name": "contrast_ratio", "feedback": -1},
    {"rule_name": "visibility_of_system_status", "feedback": 1}
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `profile` | string | Profile name |
| `items` | array | List of feedback items |

**Response**
```json
{
  "status": "success",
  "results": [
    {"rule_name": "min_button_height", "message": "Strengthened (Weight: 1.20)"},
    {"rule_name": "contrast_ratio", "message": "Relaxed (Weight: 0.80)"},
    {"rule_name": "visibility_of_system_status", "message": "Strengthened (Weight: 1.20)"}
  ]
}
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - Processing error

---

## Export Endpoints

### POST /audit/export

Generate and download a Markdown report.

**Request**
```json
{
  "meta": {
    "profile": "universal",
    "timestamp": "2026-03-17T10:30:00",
    "figma_url": "https://figma.com/..."
  },
  "summary": {
    "score": 70,
    "violations": 3
  },
  "violations": [
    {
      "id": 1,
      "rule": "min_button_height",
      "title": "Button Size Check",
      "description": "Button is too small",
      "element_info": {
        "type": "button",
        "bbox": [100, 200, 200, 240]
      }
    }
  ],
  "llm_analysis": "The button size violation reduces accessibility..."
}
```

**Response**

Returns Markdown file with headers:
```
Content-Type: text/markdown
Content-Disposition: attachment; filename=ui_audit_report.md
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - Generation error

---

## Feedback Generator Endpoints

### POST /feedback/generate

Generate multi-phase feedback for UI design using Gemini.

**Request**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ui_image` | File | Yes | UI screenshot |
| `audit_json` | File | No | Optional audit JSON |
| `analysis_type` | Form | No | `all` (default), `rules`, `elements`, `synthesis` |

**Response**
```json
{
  "status": "success",
  "images": {
    "phase1_technical": "/feedback/report/abc123_p1",
    "phase2_aesthetic": "/feedback/report/abc123_p2",
    "phase3_synthesis": "/feedback/report/abc123_p3"
  },
  "synthesis_message": "Improve Touch Targets",
  "generator_prompt": "A modern clean interface with 44px minimum button height..."
}
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - Processing error

---

### GET /feedback/report/{report_id}

Get annotated feedback image.

**Response**

Returns JPEG image file.

**Status Codes**:
- `200 OK` - Image found
- `404 Not Found` - Image not found

---

## UIGen Endpoints

### POST /uigen/generate

Run the 6-phase UIGen audit pipeline.

**Request**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ui_image` | File | Yes | UI screenshot |
| `audit_json` | File | No | Optional audit JSON |

**Response**
```json
{
  "status": "success",
  "request_id": "abc12345",
  "images": {
    "phase1": "/uigen/image/abc12345_uigen_p1.png",
    "phase2": "/uigen/image/abc12345_uigen_p2.png",
    "phase3": "/uigen/image/abc12345_uigen_p3.png",
    "phase6_improved": "/uigen/image/abc12345_uigen_p6.png"
  },
  "design_prompt": "Redesign this UI with improved accessibility...",
  "suggestions": {
    "phase1": ["Increase button height to 48px"],
    "phase2": ["Add more white space around sections"],
    "phase3": ["Improve contrast ratio in form fields"]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `500 Internal Server Error` - Pipeline error

---

### GET /uigen/image/{filename}

Serve UIGen pipeline output image.

**Response**

Returns PNG image file.

**Status Codes**:
- `200 OK` - Image found
- `404 Not Found` - Image not found

---

## Video Analysis Endpoints

### POST /video-analysis/analyze

Analyze webcam + screen recordings for UI issues.

**Request**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screen_video` | File | Yes | Screen recording (.webm) |
| `webcam_video` | File | Yes | Webcam recording (.webm) |
| `platform` | Form | No | `web` (default) or `mobile` |

**Response**
```json
{
  "session_id": "uuid-string",
  "summary": {
    "verdict": "FAIL",
    "confidence": 85,
    "total_issues": 3,
    "emotional_reactions": 2,
    "suggestions_count": 5,
    "dominant_emotion": "angry",
    "screen_motion_avg": 12.5,
    "duration_seconds": 45.2,
    "total_frames_analyzed": 15
  },
  "issues": [
    {
      "id": 1,
      "severity": "high",
      "title": "Interaction Failure",
      "desc": "User showed 'angry' emotion while interacting near 'button' element",
      "timestamp_ms": 12500,
      "time": "0:12.5s",
      "reaction": "Angry",
      "ui_element": "button",
      "bounding_box": {
        "x1": 100, "y1": 200,
        "x2": 250, "y2": 280
      },
      "recommendations": [
        "Review the response time of this element",
        "Add clear visual feedback when user interacts"
      ]
    }
  ],
  "timeline": [
    {
      "frame": 150,
      "timestamp_ms": 12500,
      "emotion": "angry",
      "ui_element": "button",
      "bounding_box": {...}
    }
  ],
  "recommendations": [
    "Review the response time of this element — users may feel it's unresponsive",
    "Add clear visual feedback when the user interacts with this component"
  ],
  "meta": {
    "platform": "web",
    "model": "YOLO (best4.pt)",
    "cam_video": "webcam.webm",
    "screen_video": "screen.webm",
    "total_frames": 450,
    "fps": 30,
    "resolution": "1920x1080"
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Missing required files
- `500 Internal Server Error` - Analysis error

---

## Error Responses

### 400 Bad Request
```json
{
  "detail": "Missing required parameter: file"
}
```

### 404 Not Found
```json
{
  "error": "Report not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "YOLO Inference failed: Model not found"
}
```

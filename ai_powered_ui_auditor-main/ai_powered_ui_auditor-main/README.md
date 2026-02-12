# 🔍 Smart UI Auditor

**AI-Powered Desktop Application for UI/UX Analysis & Improvement**

A modern Electron desktop app that analyzes user interface designs using heuristic rules, element scoring, violation detection, and live user testing with screen + webcam recording.

---

## ✨ Features

### 🎯 Upload & Import
- Drag-and-drop file upload (`.fig`, `.zip`, `.pdf`, `.png`, `.jpeg`)
- Import from URL (Figma, direct links)
- Code repository upload with VS Code-style file explorer preview
- Upload progress tracking with percentage indicator
- Persistent Navigation: Hamburger menu for quick access to Home, AI Audit, and User Testing

### 📋 UI & Violation Rules Analysis
- Evaluates designs against established UI heuristics (Visual Hierarchy, Contrast Ratio, Rule of Proximity, 60-30-10 Rule, etc.)
- Interactive rule cards with pass/fail status
- Confirmation modal for each detected violation
- Overall accuracy score with export capability

### 🧩 Element Interaction & Scoring
- Annotated UI screenshot with red bounding boxes highlighting problem areas
- Per-element scores with color-coded progress bars
- Score breakdown by category: Buttons, Input Fields, Navigation, Icons
- Overall UI score with detailed report generation

### 🔄 Combined Analysis
- Highlighted UI with green tooltip annotations suggesting fixes
- Violation panel with detailed descriptions
- Before/After comparison view (Input Interface vs. Generated Interface)
- AI-powered improvement suggestions with actionable recommendations

### 🎥 User Testing & Recording
- Permission management (Screen Recording, Webcam Access, Data Storage)
- Privacy-first approach — all processing done locally
- Countdown timer with "Ready To Test" modal
- Live recording session with webcam picture-in-picture
- Post-session analysis with:
  - Issue detection (severity, timestamps, user reactions)
  - Video replay at issue timestamps
  - AI-generated recommendations per issue
  - Stat cards (Total Issues, Emotional Reactions, Suggestions)
- Export final documentation

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Electron](https://www.electronjs.org/) 28 |
| **Frontend** | [React](https://react.dev/) 18 + TypeScript |
| **Bundler** | [Vite](https://vitejs.dev/) 5 |
| **Styling** | Vanilla CSS with custom design system |
| **Font** | [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts) |

---

## 📁 Project Structure

```
smart-ui-auditor/
├── app/                      # Electron main process
│   ├── main.js               # Window creation, IPC handlers
│   └── preload.js            # Context bridge (secure IPC)
├── scripts/
│   └── start-electron.js     # Dev launcher (env fix)
├── src/                      # React renderer
│   ├── pages/
│   │   ├── UploadPage.tsx          # File upload & import
│   │   ├── AnalysisSelection.tsx   # Analysis type selector + preview
│   │   ├── VioletRulesPage.tsx     # Heuristic rules analysis
│   │   ├── ElementInteraction.tsx  # Element scoring & annotations
│   │   ├── CombinedAnalysis.tsx    # Violations + before/after
│   │   └── UserTesting.tsx         # Recording & live analysis
│   ├── App.tsx               # Root component & navigation
│   ├── main.tsx              # React entry point
│   └── index.css             # Design system & all styles
├── index.html                # HTML shell
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript config
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### Installation

```bash
git clone https://github.com/your-username/smart-ui-auditor.git
cd smart-ui-auditor
npm install
```

### Development

#### 1. Frontend (Electron App)
```bash
npm install
npm run dev
```
This starts the Vite dev server and launches the Electron desktop application automatically.

#### 2. Backend (AI Server)
```bash
pip install -r server/requirements.txt
python3 -m uvicorn server.main:app --reload --port 8000
```
This starts the FastAPI server required for AI auditing and analysis features.

### Production Build

```bash
npm run build
```

Outputs optimized files to `dist/`.

---

## 🔄 Application Flow

```
Upload Design ──► Analysis Selection ──┬──► UI & Violation Rules ──► User Testing
                  (3 options + preview) ├──► Element Interaction  ──► User Testing
                                        └──► Combined Analysis   ──► User Testing
```

1. **Upload** — Drag-drop a design file or paste a URL
2. **Select Analysis** — Choose from 3 analysis types; uploaded image shown as preview
3. **Analysis** — View results specific to the chosen analysis type
4. **User Testing** — Record a live session and get AI-powered recommendations

---

## 🎨 Design System

The app uses a custom design system built with CSS custom properties:

- **Colors**: Blue-purple gradient backgrounds, green accents, pink-gradient cards
- **Typography**: Inter font family, 8 weight/size tokens
- **Effects**: Glassmorphism cards, gradient blobs, smooth micro-animations
- **Components**: Buttons, modals, cards, spinners, progress bars, upload zones, annotation badges

---

## 📄 License

MIT

---

## 🙏 Acknowledgments

- UI/UX designs from Figma research mockups
- Built with Electron, React, Vite, and TypeScript

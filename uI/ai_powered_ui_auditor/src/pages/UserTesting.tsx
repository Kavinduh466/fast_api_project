import { useState, useEffect, useRef, useMemo } from 'react'

interface UserTestingProps {
    step: string
    onBack: () => void
    onStartRecording: () => void
    onStopRecording: () => void
    onAnalyse: () => void
    onBackToReview: () => void
    onExport: () => void
    onDiscard: () => void
}

declare global {
    interface Window {
        electronAPI?: {
            getSources: () => Promise<any[]>;
            getAppInfo: () => Promise<any>;
        }
    }
}

// Issue type from the AI analysis API
interface AnalysisIssue {
    id: number
    severity: 'high' | 'medium' | 'low'
    title: string
    desc: string
    time: string
    timestamp_ms: number
    reaction: string
    ui_element: string
    bounding_box: { x1: number; y1: number; x2: number; y2: number }
    recommendations: string[]
}

interface AnalysisResult {
    summary: {
        verdict: string
        confidence: number
        total_issues: number
        emotional_reactions: number
        suggestions_count: number
        dominant_emotion: string
        screen_motion_avg: number
        duration_seconds: number
        total_frames_analyzed: number
    }
    issues: AnalysisIssue[]
    timeline: any[]
    recommendations: string[]
    meta: any
    session_id: string
}

export default function UserTesting({ step, onBack, onStartRecording, onStopRecording, onAnalyse, onBackToReview, onExport, onDiscard }: UserTestingProps) {
    const [permissions, setPermissions] = useState({ screen: false, webcam: false, storage: false })
    const [platform, setPlatform] = useState<'web' | 'mobile'>('web')
    const [showTimesUpModal, setShowTimesUpModal] = useState(false)
    const [showExportModal, setShowExportModal] = useState(false)
    const [timeRemaining, setTimeRemaining] = useState(120)
    const [isRecording, setIsRecording] = useState(false)
    const [isCaptureStarted, setIsCaptureStarted] = useState(false) // Whether MediaRecorder is active
    const [recordingStopped, setRecordingStopped] = useState(false) // Show review after stop
    const [expandedIssue, setExpandedIssue] = useState<number | null>(null)
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [analysisLoading, setAnalysisLoading] = useState(false)
    const [analysisError, setAnalysisError] = useState<string | null>(null)

    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const screenVideoRef = useRef<HTMLVideoElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const [activeScreenStream, setActiveScreenStream] = useState<MediaStream | null>(null)
    const [activeWebcamStream, setActiveWebcamStream] = useState<MediaStream | null>(null)

    // Recording Refs
    const screenRecorderRef = useRef<MediaRecorder | null>(null)
    const webcamRecorderRef = useRef<MediaRecorder | null>(null)
    const screenChunksRef = useRef<Blob[]>([])
    const webcamChunksRef = useRef<Blob[]>([])
    const [recordedBlobs, setRecordedBlobs] = useState<{ screen?: Blob, webcam?: Blob }>({})

    // Memoized object URL for screen recording preview (avoids creating new URLs on every render)
    const screenPreviewUrl = useMemo(() => {
        if (recordedBlobs.screen) {
            return URL.createObjectURL(recordedBlobs.screen);
        }
        return null;
    }, [recordedBlobs.screen]);

    // Cleanup the object URL when it changes or on unmount
    useEffect(() => {
        return () => {
            if (screenPreviewUrl) URL.revokeObjectURL(screenPreviewUrl);
        };
    }, [screenPreviewUrl]);

    // Recording timer
    useEffect(() => {
        if (isCaptureStarted) {
            timerRef.current = setInterval(() => {
                setTimeRemaining(t => {
                    if (t <= 1) {
                        handleStopSession();
                        setShowTimesUpModal(true);
                        return 0;
                    }
                    return t - 1;
                });
            }, 1000);
            return () => { if (timerRef.current) clearInterval(timerRef.current) }
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }
    }, [isCaptureStarted])

    // Cleanup on unmount
    useEffect(() => {
        return () => stopAllStreams()
    }, [])

    const stopAllStreams = () => {
        console.log("Stopping all streams and recording...");

        if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
            try { screenRecorderRef.current.stop(); } catch (e) { }
        }
        if (webcamRecorderRef.current && webcamRecorderRef.current.state !== 'inactive') {
            try { webcamRecorderRef.current.stop(); } catch (e) { }
        }

        if (activeScreenStream) {
            activeScreenStream.getTracks().forEach(track => track.stop());
            setActiveScreenStream(null);
        }
        if (activeWebcamStream) {
            activeWebcamStream.getTracks().forEach(track => track.stop());
            setActiveWebcamStream(null);
        }

        if (timerRef.current) clearInterval(timerRef.current);
    }

    const handleDiscard = () => {
        console.log("Discarding recording and resetting state...");
        stopAllStreams();

        // Reset all states
        setIsRecording(false);
        setIsCaptureStarted(false);
        setRecordingStopped(false);
        setRecordedBlobs({});
        setAnalysisResult(null);
        setAnalysisError(null);
        setTimeRemaining(60);
        setShowTimesUpModal(false);
        setShowExportModal(false);
        setExpandedIssue(null);

        // Navigate back to permissions
        onDiscard();
    }

    const generateAuditReport = (result: AnalysisResult): string => {
        const { summary, issues, recommendations } = result;
        const dateStr = new Date().toLocaleString();

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>UI Audit Report - ${dateStr}</title>
    <style>
        :root {
            --primary: #7CB342;
            --secondary: #2E7D32;
            --bg: #f8f9ff;
            --card: #ffffff;
            --text: #1a1a2e;
            --text-muted: #64748b;
            --red: #EF5350;
            --orange: #FFA726;
            --blue: #42A5F5;
        }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; margin: 0; padding: 40px 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 50px; }
        .header h1 { font-size: 2.5rem; color: var(--secondary); margin-bottom: 10px; }
        .header p { color: var(--text-muted); font-size: 1.1rem; }
        
        .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
        .stat-card { background: var(--card); padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); text-align: center; border-bottom: 4px solid var(--primary); }
        .stat-card.fail { border-bottom-color: var(--red); }
        .stat-card h3 { margin: 0; font-size: 0.9rem; text-transform: uppercase; color: var(--text-muted); }
        .stat-card .value { font-size: 2.5rem; font-weight: 800; color: var(--text); margin: 10px 0; }
        
        .section-title { font-size: 1.8rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin: 40px 0 20px; color: var(--text); }
        
        .issue-card { background: var(--card); border-radius: 12px; padding: 20px; margin-bottom: 20px; border-left: 5px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.03); }
        .severity-high { border-left-color: var(--red); }
        .severity-medium { border-left-color: var(--orange); }
        .severity-low { border-left-color: var(--blue); }
        
        .issue-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .severity-badge { padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; }
        .badge-high { background: #ffebee; color: var(--red); }
        .badge-medium { background: #fff3e0; color: #e65100; }
        .badge-low { background: #e3f2fd; color: #0d47a1; }
        
        .issue-title { font-size: 1.2rem; font-weight: 700; margin: 0; flex-grow: 1; margin-left: 15px; }
        .issue-time { color: var(--text-muted); font-size: 0.9rem; }
        
        .issue-details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px; padding-top: 15px; border-top: 1px dashed #eee; }
        .detail-item strong { display: block; font-size: 0.8rem; color: var(--text-muted); }
        
        .recs-container { background: #f1f8e9; padding: 20px; border-radius: 12px; border-left: 4px solid var(--primary); }
        .rec-item { display: flex; gap: 10px; margin-bottom: 10px; }
        .rec-item:last-child { margin-bottom: 0; }
        .rec-item span { color: var(--primary); font-weight: 800; }
        
        .footer { text-align: center; margin-top: 60px; color: var(--text-muted); font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>UI Audit Report</h1>
            <p>Generated by Smart UI Auditor on ${dateStr}</p>
            <div style="margin-top: 20px;">
                <span style="padding: 6px 15px; background: ${summary.verdict === 'PASS' ? '#e8f5e9' : '#ffebee'}; color: ${summary.verdict === 'PASS' ? '#2e7d32' : '#c62828'}; border-radius: 20px; font-weight: 700;">
                    ${summary.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'} (${summary.confidence}% Confidence)
                </span>
            </div>
        </div>

        <div class="summary-grid">
            <div class="stat-card">
                <h3>Total Issues</h3>
                <div class="value">${summary.total_issues}</div>
            </div>
            <div class="stat-card">
                <h3>Reaction Count</h3>
                <div class="value">${summary.emotional_reactions}</div>
            </div>
            <div class="stat-card">
                <h3>Duration</h3>
                <div class="value">${Math.floor(summary.duration_seconds)}s</div>
            </div>
        </div>

        <h2 class="section-title">Timeline of Findings</h2>
        ${issues.map(issue => `
            <div class="issue-card severity-${issue.severity}">
                <div class="issue-header">
                    <span class="severity-badge badge-${issue.severity}">${issue.severity}</span>
                    <h3 class="issue-title">${issue.title}</h3>
                    <span class="issue-time">${issue.time}</span>
                </div>
                <p>User demonstrated <strong>${issue.reaction}</strong> reaction while interacting with this area.</p>
                <div class="issue-details">
                    <div class="detail-item">
                        <strong>Targeted Component</strong>
                        ${issue.ui_element}
                    </div>
                    <div class="detail-item">
                        <strong>Bounding Box</strong>
                        (${issue.bounding_box.x1}, ${issue.bounding_box.y1}) to (${issue.bounding_box.x2}, ${issue.bounding_box.y2})
                    </div>
                </div>
                <div style="margin-top: 15px;">
                    <strong>Recommended Fixes:</strong>
                    <ul style="margin: 10px 0 0 0; padding-left: 20px; font-size: 0.95rem;">
                        ${issue.recommendations.map(r => `<li>${r}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `).join('')}

        <h2 class="section-title">Key Recommendations</h2>
        <div class="recs-container">
            ${recommendations.map((rec, i) => `
                <div class="rec-item">
                    <span>${i + 1}.</span>
                    <div>${rec}</div>
                </div>
            `).join('')}
        </div>

        <div class="footer">
            &copy; ${new Date().getFullYear()} Smart UI Auditor. All analysis processing performed locally.
        </div>
    </div>
</body>
</html>
        `;
    }

    const requestScreenAccess = async () => {
        // In Electron: always use desktopCapturer via IPC for screen capture
        if (window.electronAPI) {
            try {
                console.log("Electron: Getting screen sources via IPC...");
                const sources = await window.electronAPI.getSources();
                if (sources && sources.length > 0) {
                    const screenSource = sources.find((s: any) => s.id.startsWith('screen')) || sources[0];
                    console.log("Electron: Got screen source:", screenSource.name);
                    // Get the actual stream using the desktopCapturer source
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: screenSource.id,
                            }
                        } as any
                    });
                    console.log("Electron: Screen stream acquired and persisted.");
                    setActiveScreenStream(stream);
                    setPermissions(p => ({ ...p, screen: true }));
                    return;
                }
            } catch (err) {
                console.error("Electron screen capture failed:", err);
                alert("Screen capture failed. Please ensure Screen Recording is enabled in System Settings > Privacy & Security > Screen Recording.");
                return;
            }
        }

        // Browser fallback: use getDisplayMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            alert(`Screen recording is not supported in this environment.`);
            return;
        }

        try {
            console.log("Browser: Requesting screen access via getDisplayMedia...");
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            console.log("Browser: Screen access granted. Persisting stream.");
            setActiveScreenStream(stream);
            setPermissions(p => ({ ...p, screen: true }));
        } catch (err: any) {
            console.error("Screen access error:", err);
            alert(`Screen recording failed: ${err.message || 'Unknown error'}`);
        }
    }


    const requestWebcamAccess = async () => {
        try {
            console.log("Requesting webcam access...");
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            console.log("Webcam access granted. Persisting stream.");
            setActiveWebcamStream(stream);
            setPermissions(p => ({ ...p, webcam: true }))
        } catch (err: any) {
            console.error("Webcam access error:", err);
            alert(`Webcam access failed: ${err.message || 'Check if another app is using the camera'}`);
        }
    }

    // Initial stream setup for preview ONLY
    const setupPreviews = async () => {
        try {
            console.log("Setting up previews...");

            // Reuse existing streams if they are already active in state
            if (activeScreenStream && activeScreenStream.active && activeWebcamStream && activeWebcamStream.active) {
                console.log("Reusing existing active streams for preview.");
                return;
            }

            // Screen: acquire if not already active
            if (!activeScreenStream || !activeScreenStream.active) {
                console.log("Screen stream missing or inactive, acquiring...");
                if (window.electronAPI) {
                    // Electron: use desktopCapturer
                    const sources = await window.electronAPI.getSources();
                    const screenSource = sources.find((s: any) => s.id.startsWith('screen')) || sources[0];
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: screenSource.id,
                            }
                        } as any
                    });
                    setActiveScreenStream(stream);
                } else {
                    // Browser fallback
                    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                    setActiveScreenStream(stream);
                }
            }

            // Webcam: acquire if not already active
            if (!activeWebcamStream || !activeWebcamStream.active) {
                console.log("Webcam stream missing or inactive, acquiring...");
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                setActiveWebcamStream(stream);
            }

            console.log("Preview streams ready.");
        } catch (err) {
            console.error("Failed to setup previews:", err);
            alert("Could not access camera or screen. Please check permissions in System Settings > Privacy & Security.");
        }
    }


    // Start ACTUAL recording
    const startRecordingSession = () => {
        if (!activeScreenStream || !activeWebcamStream) {
            console.error("Streams not ready for recording, attempting recapture...");
            setupPreviews().then(() => {
                if (activeScreenStream && activeWebcamStream) {
                    performStartRecording();
                }
            });
            return;
        }
        performStartRecording();
    }

    const performStartRecording = () => {
        console.log("Initializing MediaRecorders with active streams...");

        // Reset chunks
        screenChunksRef.current = [];
        webcamChunksRef.current = [];

        try {
            // Setup Screen Recorder
            const screenRecorder = new MediaRecorder(activeScreenStream!, { mimeType: 'video/webm;codecs=vp8' });
            screenRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) screenChunksRef.current.push(e.data);
            };
            screenRecorder.onstop = () => {
                const blob = new Blob(screenChunksRef.current, { type: 'video/webm' });
                setRecordedBlobs(prev => ({ ...prev, screen: blob }));
            };
            screenRecorderRef.current = screenRecorder;
            screenRecorder.start(1000);

            // Setup Webcam Recorder
            const webcamRecorder = new MediaRecorder(activeWebcamStream!, { mimeType: 'video/webm;codecs=vp8' });
            webcamRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) webcamChunksRef.current.push(e.data);
            };
            webcamRecorder.onstop = () => {
                const blob = new Blob(webcamChunksRef.current, { type: 'video/webm' });
                setRecordedBlobs(prev => ({ ...prev, webcam: blob }));
            };
            webcamRecorderRef.current = webcamRecorder;
            webcamRecorder.start(1000);

            setIsCaptureStarted(true);
            setTimeRemaining(60); // 60 second limit
            console.log("Recording session started");
        } catch (e) {
            console.error("MediaRecorder start failed:", e);
            alert("Failed to start recording. Please try again.");
        }
    }

    const handleStopSession = () => {
        console.log("Stopping session...");
        // Stop recorders first (this triggers onstop which sets blobs)
        if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') {
            screenRecorderRef.current.stop();
        }
        if (webcamRecorderRef.current && webcamRecorderRef.current.state !== 'inactive') {
            webcamRecorderRef.current.stop();
        }
        // Stop all streams
        if (activeScreenStream) {
            activeScreenStream.getTracks().forEach(track => track.stop());
            setActiveScreenStream(null);
        }
        if (activeWebcamStream) {
            activeWebcamStream.getTracks().forEach(track => track.stop());
            setActiveWebcamStream(null);
        }
        if (timerRef.current) clearInterval(timerRef.current);
        setIsRecording(false);
        setIsCaptureStarted(false);
        // Show the review UI instead of navigating away
        setRecordingStopped(true);
    }

    // Save recordings to local disk
    const saveRecordingsLocally = () => {
        const timestamp = Date.now();
        if (recordedBlobs.screen) {
            const url = URL.createObjectURL(recordedBlobs.screen);
            const a = document.createElement('a');
            a.href = url;
            a.download = `screen-recording-${timestamp}.webm`;
            a.click();
            URL.revokeObjectURL(url);
        }
        if (recordedBlobs.webcam) {
            const url = URL.createObjectURL(recordedBlobs.webcam);
            const a = document.createElement('a');
            a.href = url;
            a.download = `webcam-recording-${timestamp}.webm`;
            a.click();
            URL.revokeObjectURL(url);
        }
        console.log("Recordings saved locally.");
    }

    // Sync video elements with state streams
    useEffect(() => {
        if (screenVideoRef.current && activeScreenStream) {
            if (screenVideoRef.current.srcObject !== activeScreenStream) {
                console.log("Assigning screen stream to video");
                screenVideoRef.current.srcObject = activeScreenStream;
                screenVideoRef.current.play().catch(e => console.warn("Auto-play screen blocked:", e));
            }
        }
    }, [activeScreenStream, step, recordingStopped, permissions.screen]);

    useEffect(() => {
        if (webcamVideoRef.current && activeWebcamStream) {
            if (webcamVideoRef.current.srcObject !== activeWebcamStream) {
                console.log("Assigning webcam stream to video");
                webcamVideoRef.current.srcObject = activeWebcamStream;
                webcamVideoRef.current.play().catch(e => console.warn("Auto-play webcam blocked:", e));
            }
        }
    }, [activeWebcamStream, step, recordingStopped, permissions.webcam]);

    // Setup previews when entering recording step
    useEffect(() => {
        if (step === 'recording') {
            setupPreviews();
        }
        // Don't stopAllStreams here — we want to keep streams alive between permission and recording steps
    }, [step])

    const allGranted = permissions.screen && permissions.webcam && permissions.storage

    // Permissions Screen
    if (step === 'permissions') {
        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        onClick={onBack}
                        className="back-button-circle"
                        title="Back to Home"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>Required Permissions</h1>
                </div>
                <p className="page-subheading">We need your permission to record your screen and webcam to analyze UI interactions and user behavior.</p>

                <div className={`permission-card ${permissions.screen ? 'permission-card--granted' : ''}`}>
                    <div className="permission-card__icon">🖥️</div>
                    <div className="permission-card__info">
                        <div className="permission-card__title">Screen Recording</div>
                        <div className="permission-card__desc">Capture UI Interactions, Clicks, Scrolls and Navigations</div>
                    </div>
                    {permissions.screen ? (
                        <div className="permission-card__check">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                    ) : (
                        <button className="btn btn-green-solid" onClick={requestScreenAccess}>Grant Access</button>
                    )}
                </div>

                <div className={`permission-card ${permissions.webcam ? 'permission-card--granted' : ''}`}>
                    <div className="permission-card__icon">📷</div>
                    <div className="permission-card__info">
                        <div className="permission-card__title">Webcam Access</div>
                        <div className="permission-card__desc">Analyse Facial expressions, eye Movement and Emotions</div>
                    </div>
                    {permissions.webcam ? (
                        <div className="permission-card__check">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                    ) : (
                        <button className="btn btn-green-solid" onClick={requestWebcamAccess}>Grant Access</button>
                    )}
                </div>

                <div className={`permission-card ${permissions.storage ? 'permission-card--granted' : ''}`}>
                    <div className="permission-card__icon">🎥</div>
                    <div className="permission-card__info">
                        <div className="permission-card__title">Data Storage</div>
                        <div className="permission-card__desc">Save recordings and analysis results locally</div>
                    </div>
                    {permissions.storage ? (
                        <div className="permission-card__check">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                    ) : (
                        <button className="btn btn-green-solid" onClick={() => setPermissions(p => ({ ...p, storage: true }))}>Accept</button>
                    )}
                </div>

                {/* Platform Selector */}
                <div className="permission-card permission-card--granted">
                    <div className="permission-card__icon">📱</div>
                    <div className="permission-card__info">
                        <div className="permission-card__title">Platform Type</div>
                        <div className="permission-card__desc">Select the platform your UI is designed for</div>
                    </div>
                    <select
                        id="platform-select"
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value as 'web' | 'mobile')}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            border: '1px solid rgba(255,255,255,0.15)',
                            background: 'rgba(0,0,0,0.05)',
                            color: 'var(--text-primary)',
                            fontSize: '0.95rem',
                            fontWeight: 500,
                            cursor: 'pointer',
                            outline: 'none',
                            minWidth: '130px',
                        }}
                    >
                        <option value="web" style={{ background: '#fff', color: '#000' }}>🖥️ Web</option>
                        <option value="mobile" style={{ background: '#fff', color: '#000' }}>📱 Mobile</option>
                    </select>
                </div>

                <div className="privacy-notice-v2">
                    <div className="privacy-notice-v2__icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    </div>
                    <div className="privacy-notice-v2__content">
                        <div className="privacy-notice-v2__title">Privacy Notice</div>
                        <div className="privacy-notice-v2__text">All recordings are processed locally. Your Data is anonymized and never shared without consent</div>
                    </div>
                </div>

                {allGranted && (
                    <div className="text-center mt-8">
                        <button
                            className="btn btn-primary btn-primary-lg shadow-glow"
                            style={{ width: '100%', maxWidth: 400 }}
                            onClick={() => {
                                setIsRecording(true);
                                onStartRecording();
                            }}
                        >
                            Start Recording Session
                        </button>
                    </div>
                )}
            </div>
        )
    }

    // Recording Session
    if (step === 'recording') {
        // Post-recording review
        if (recordingStopped) {
            return (
                <div style={{ maxWidth: 800, margin: '0 auto' }}>
                    <h1 className="page-heading">Recording Complete</h1>
                    <p className="page-subheading">Your session has been recorded. Review and save your footage below.</p>

                    {/* Recorded Videos */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                        <div>
                            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>🖥️ Screen Recording</h3>
                            {recordedBlobs.screen ? (
                                <video
                                    src={URL.createObjectURL(recordedBlobs.screen)}
                                    controls
                                    style={{ width: '100%', borderRadius: 12, background: '#000' }}
                                />
                            ) : (
                                <div style={{ background: '#1e1e1e', borderRadius: 12, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                                    No screen recording available
                                </div>
                            )}
                        </div>
                        <div>
                            <h3 style={{ marginBottom: '0.5rem', fontWeight: 700 }}>📷 Webcam Recording</h3>
                            {recordedBlobs.webcam ? (
                                <video
                                    src={URL.createObjectURL(recordedBlobs.webcam)}
                                    controls
                                    style={{ width: '100%', borderRadius: 12, background: '#000' }}
                                />
                            ) : (
                                <div style={{ background: '#1e1e1e', borderRadius: 12, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                                    No webcam recording available
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            className="btn btn-outline"
                            onClick={saveRecordingsLocally}
                        >
                            💾 Save Recordings Locally
                        </button>
                        <button
                            className="btn btn-primary btn-primary-lg shadow-glow"
                            disabled={analysisLoading}
                            onClick={async () => {
                                if (!recordedBlobs.screen || !recordedBlobs.webcam) {
                                    alert('Both screen and webcam recordings are required for analysis.');
                                    return;
                                }
                                onAnalyse(); // Switch step to 'user-analysis' in App.tsx
                                setAnalysisLoading(true);
                                setAnalysisError(null);
                                try {
                                    const formData = new FormData();
                                    formData.append('screen_video', recordedBlobs.screen, `screen-${Date.now()}.webm`);
                                    formData.append('webcam_video', recordedBlobs.webcam, `webcam-${Date.now()}.webm`);
                                    formData.append('platform', platform);

                                    const response = await fetch('http://localhost:8000/video-analysis/analyze', {
                                        method: 'POST',
                                        body: formData
                                    });

                                    if (!response.ok) {
                                        throw new Error(`Server error: ${response.status}`);
                                    }

                                    const result = await response.json();
                                    if (result.error) {
                                        throw new Error(result.error);
                                    }

                                    setAnalysisResult(result);
                                    onStopRecording();
                                } catch (err: any) {
                                    console.error('Analysis failed:', err);
                                    setAnalysisError(err.message || 'Analysis failed');
                                    onBackToReview(); // Switch step back to 'recording' to show error on review UI
                                } finally {
                                    setAnalysisLoading(false);
                                }
                            }}
                        >
                            🚀 Start Analysis
                        </button>
                        <button
                            className="btn btn-danger"
                            disabled={analysisLoading}
                            onClick={handleDiscard}
                        >
                            🗑️ Discard
                        </button>
                    </div>

                    {/* Analysis Error shown on the review UI */}
                    {analysisError && (
                        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,0,0,0.1)', borderRadius: 8, color: 'var(--red-high)', textAlign: 'center' }}>
                            ⚠️ {analysisError}
                        </div>
                    )}
                </div>
            )
        }

        // Active recording / preview
        return (
            <div className="recording-container">
                <div className="recording-timer">
                    <div className="recording-timer__label">
                        {isCaptureStarted ? 'Recording' : 'Preview'}
                    </div>
                    <div className="recording-timer__value" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        {isCaptureStarted && <span className="recording-dot" />}
                        <span>{Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}</span>
                    </div>
                </div>

                {/* Recording Preview */}
                <div className="recording-preview real-media">
                    {/* Screen Stream */}
                    <video
                        ref={screenVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className="screen-video-feed"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                    />

                    {/* Webcam PiP */}
                    <div className="webcam-pip real-webcam">
                        <video
                            ref={webcamVideoRef}
                            autoPlay
                            muted
                            playsInline
                            className="webcam-video-feed"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                borderRadius: 'inherit',
                                transform: 'scaleX(-1)' // Mirror effect
                            }}
                        />
                    </div>

                    {/* Start Recording Button — shown before capture */}
                    {!isCaptureStarted && (
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            padding: '2rem',
                            background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            zIndex: 100,
                            pointerEvents: 'all'
                        }}>
                            <button
                                className="btn btn-primary btn-primary-lg shadow-glow"
                                style={{
                                    padding: '1rem 4rem',
                                    borderRadius: 100,
                                }}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    startRecordingSession();
                                }}
                            >
                                🔴 Start Recording
                            </button>
                        </div>
                    )}

                    {/* Stop button — shown during capture */}
                    {isCaptureStarted && (
                        <div className="recording-stop" onClick={handleStopSession}>
                            <div className="recording-stop__btn" />
                            <span className="recording-stop__label">Stop Record</span>
                        </div>
                    )}
                </div>

                {/* Time's Up Modal */}
                {showTimesUpModal && (
                    <div className="modal-overlay">
                        <div className="modal">
                            <h2 className="modal__title" style={{ color: 'var(--red-high)' }}>Time is up!</h2>
                            <p className="modal__body">
                                Your 60-second recording session has ended. Review and save your footage.
                            </p>
                            <div className="modal__actions">
                                <button className="btn btn-primary btn-primary-lg" onClick={() => setShowTimesUpModal(false)}>Review Recording</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }


    // Analyse UI Loading
    if (step === 'user-analysis') {
        return (
            <div className="spinner-container">
                <div className="spinner" />
                <div className="spinner-text">Analyse UI</div>
            </div>
        )
    }

    // Analysis Complete / Results
    const issues: AnalysisIssue[] = analysisResult?.issues ?? []
    const summary = analysisResult?.summary
    const durationDisplay = summary
        ? `${Math.floor(summary.duration_seconds / 60)}:${String(Math.floor(summary.duration_seconds % 60)).padStart(2, '0')}`
        : '00:00'

    return (
        <div>
            <h1 className="page-heading">Analysis Complete</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
                Session Duration: {durationDisplay}
                {summary && (
                    <span style={{
                        marginLeft: '1rem',
                        padding: '0.25rem 0.75rem',
                        borderRadius: 20,
                        fontWeight: 700,
                        fontSize: 'var(--font-sm)',
                        background: summary.verdict === 'PASS' ? 'rgba(0,200,100,0.15)' : 'rgba(255,50,50,0.15)',
                        color: summary.verdict === 'PASS' ? 'var(--green-accent)' : 'var(--red-high)'
                    }}>
                        {summary.verdict === 'PASS' ? '✅' : '❌'} {summary.verdict} — {summary.confidence}% Confidence
                    </span>
                )}
            </p>

            {/* Stat Cards */}
            <div className="stat-cards">
                <div className="stat-card stat-card--red">
                    <div className="stat-card__label">Total Issues</div>
                    <div className="stat-card__value">{summary?.total_issues ?? 0}</div>
                </div>
                <div className="stat-card stat-card--blue">
                    <div className="stat-card__label">Emotional Reactions</div>
                    <div className="stat-card__value">{summary?.emotional_reactions ?? 0}</div>
                </div>
                <div className="stat-card stat-card--green">
                    <div className="stat-card__label">Suggestions</div>
                    <div className="stat-card__value">{summary?.suggestions_count ?? 0}</div>
                </div>
            </div>

            {/* Issues List */}
            <h2 style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, marginBottom: 'var(--space-4)' }}>Identified Issues & Replay</h2>

            {issues.length === 0 && (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', borderRadius: 12 }}>
                    <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✨</p>
                    <p style={{ fontWeight: 600 }}>No Issues Detected</p>
                    <p>The UI appears to be functioning well — no negative user reactions were observed.</p>
                </div>
            )}

            {issues.map((issue) => (
                <div key={issue.id}>
                    <div className="issue-card">
                        <div className="issue-card__content">
                            <div>
                                <span className={`issue-card__severity severity-${issue.severity}`}>{issue.severity}</span>
                                <span className="issue-card__title">{issue.title}</span>
                            </div>
                            <div className="issue-card__desc">{issue.desc}</div>
                            <div className="issue-card__meta">
                                <span>⏱ Occurred at {issue.time}</span>
                                <span>😟 User Reaction: {issue.reaction}</span>
                            </div>
                        </div>
                        <div className="issue-card__replay">
                            <button
                                className="btn btn-primary"
                                onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}
                            >
                                {expandedIssue === issue.id ? '▼ Hide' : '▶ Details'}
                            </button>
                        </div>
                    </div>

                    {/* Expanded with element info, video preview & recommendations */}
                    {expandedIssue === issue.id && (
                        <div style={{ paddingLeft: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
                            {/* Screen Recording Preview at Timestamp */}
                            {screenPreviewUrl && (
                                <div style={{
                                    marginBottom: 'var(--space-4)',
                                    background: 'rgba(0,0,0,0.4)',
                                    borderRadius: 12,
                                    overflow: 'hidden',
                                    border: '1px solid rgba(255,255,255,0.08)'
                                }}>
                                    <div style={{
                                        padding: '0.5rem 1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: 'var(--font-sm)',
                                        color: 'var(--text-secondary)',
                                        borderBottom: '1px solid rgba(255,255,255,0.06)'
                                    }}>
                                        <span>🖥️</span>
                                        <span>Screen at <strong style={{ color: 'var(--text-primary)' }}>{issue.time}</strong></span>
                                        <span style={{
                                            marginLeft: 'auto',
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: 6,
                                            background: issue.severity === 'high' ? 'rgba(255,50,50,0.15)' : issue.severity === 'medium' ? 'rgba(255,180,0,0.15)' : 'rgba(100,200,255,0.15)',
                                            color: issue.severity === 'high' ? 'var(--red-high)' : issue.severity === 'medium' ? '#ffb400' : '#64c8ff',
                                            fontSize: '0.75rem',
                                            fontWeight: 700
                                        }}>{issue.reaction}</span>
                                    </div>
                                    <video
                                        style={{
                                            width: '100%',
                                            maxHeight: 280,
                                            objectFit: 'contain',
                                            display: 'block',
                                            background: '#000'
                                        }}
                                        src={screenPreviewUrl}
                                        controls
                                        muted
                                        playsInline
                                        preload="metadata"
                                        onLoadedMetadata={(e) => {
                                            const video = e.currentTarget;
                                            const seekTime = (issue.timestamp_ms || 0) / 1000;
                                            video.currentTime = seekTime;
                                        }}
                                    />
                                </div>
                            )}

                            <div style={{
                                padding: '0.75rem 1rem',
                                background: 'rgba(255,255,255,0.03)',
                                borderRadius: 8,
                                marginBottom: 'var(--space-3)',
                                fontSize: 'var(--font-sm)'
                            }}>
                                <strong>UI Element:</strong> {issue.ui_element}
                                {issue.bounding_box && (
                                    <span style={{ color: 'var(--text-muted)', marginLeft: '1rem' }}>
                                        at ({issue.bounding_box.x1}, {issue.bounding_box.y1}) → ({issue.bounding_box.x2}, {issue.bounding_box.y2})
                                    </span>
                                )}
                            </div>

                            <div className="recommendations">
                                <div className="recommendations__title">💡 Recommendations</div>
                                <div className="recommendations__subtitle">Based on the detected issue and user behavior analysis</div>
                                {(issue.recommendations || []).map((rec, idx) => {
                                    const markers = ['①', '②', '③', '④', '⑤']
                                    return (
                                        <div className="recommendations__item" key={idx}>
                                            <span>{markers[idx] || `${idx + 1}.`}</span> {rec}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {/* Overall Recommendations */}
            {analysisResult?.recommendations && analysisResult.recommendations.length > 0 && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                    <h2 style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, marginBottom: 'var(--space-4)' }}>Overall Recommendations</h2>
                    <div className="recommendations">
                        {analysisResult.recommendations.map((rec, idx) => (
                            <div className="recommendations__item" key={idx}>
                                <span>{idx + 1}.</span> {rec}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Export Modal Trigger */}
            <div className="footer-actions">
                <button className="btn btn-primary btn-primary-lg" onClick={() => setShowExportModal(true)}>Finish</button>
            </div>

            {/* Export Modal */}
            {showExportModal && (
                <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h2 className="modal__title">All Done!</h2>
                        <p className="modal__body">Export Your Final Documentation</p>
                        <div className="modal__actions">
                            <button className="btn btn-primary btn-primary-lg" onClick={() => {
                                // 1. Download Screen Video
                                if (recordedBlobs.screen) {
                                    const url = URL.createObjectURL(recordedBlobs.screen);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `user-testing-screen-${Date.now()}.webm`;
                                    a.click();
                                }
                                // 2. Download Webcam Video
                                if (recordedBlobs.webcam) {
                                    const url = URL.createObjectURL(recordedBlobs.webcam);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `user-testing-webcam-${Date.now()}.webm`;
                                    a.click();
                                }
                                // 3. Download HTML Audit Report
                                if (analysisResult) {
                                    const htmlContent = generateAuditReport(analysisResult);
                                    const blob = new Blob([htmlContent], { type: 'text/html' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `ui-audit-report-${Date.now()}.html`;
                                    a.click();
                                }

                                setShowExportModal(false);
                                onExport();
                            }}>Export & Download</button>
                            <button className="btn btn-outline btn-primary-lg" onClick={handleDiscard}>Discard</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

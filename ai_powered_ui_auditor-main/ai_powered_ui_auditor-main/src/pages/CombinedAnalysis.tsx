import { useState, useRef, useCallback } from 'react'

type AnalysisOption = 'rules' | 'elements' | 'all'
type PageStep = 'selection' | 'processing' | 'results'

interface CombinedAnalysisProps {
    onBack: () => void
}

const ANALYSIS_OPTIONS: { id: AnalysisOption; title: string; desc: string }[] = [
    { id: 'rules', title: 'UI & Violation Rules set', desc: 'Analyse UI against design violation rules and best practices' },
    { id: 'elements', title: 'UI & Element Score', desc: 'Detect and score individual UI elements against expert patterns' },
    { id: 'all', title: 'UI | Violation Rules set | Element Score', desc: 'Complete analysis — rules, element scoring, and enhancement' },
]

export default function CombinedAnalysis({ onBack }: CombinedAnalysisProps) {
    const [selected, setSelected] = useState<AnalysisOption>('all')
    const [pageStep, setPageStep] = useState<PageStep>('selection')
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [uploadedFile, setUploadedFile] = useState<File | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [results, setResults] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [processingStatus, setProcessingStatus] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    const simulateUpload = useCallback((file: File) => {
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
        setUploadedFile(file)
        setUploadProgress(0)
        setError(null)

        let progress = 0
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5
            if (progress >= 100) {
                progress = 100
                clearInterval(interval)
            }
            setUploadProgress(progress)
        }, 300)
    }, [])

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f && f.type.startsWith('image/')) simulateUpload(f)
    }, [simulateUpload])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (f) simulateUpload(f)
    }, [simulateUpload])

    const handleStartAnalysis = async () => {
        if (!uploadedFile) {
            setError('Please upload a UI screenshot first.')
            return
        }

        setPageStep('processing')
        setError(null)

        try {
            let comp1Result: any = null
            let comp2Result: any = null

            // --- Comp 1: AI Audit (rules) ---
            if (selected === 'rules' || selected === 'all') {
                setProcessingStatus('Running AI Audit (Violation Rules)…')
                const formData = new FormData()
                formData.append('file', uploadedFile, uploadedFile.name)
                formData.append('profile', 'universal')

                const res = await fetch('http://localhost:8000/audit/smart', {
                    method: 'POST',
                    body: formData,
                })
                comp1Result = await res.json()
            }

            // --- Comp 2: Element Audit ---
            if (selected === 'elements' || selected === 'all') {
                setProcessingStatus('Running Element Audit…')
                const formData = new FormData()
                formData.append('file', uploadedFile, uploadedFile.name)

                const res = await fetch('http://localhost:8000/audit', {
                    method: 'POST',
                    body: formData,
                })
                comp2Result = await res.json()
            }

            // --- Comp 3: UI Enhancer (feedback/generate) ---
            setProcessingStatus('Generating Enhanced UI…')
            const enhanceFormData = new FormData()
            enhanceFormData.append('ui_image', uploadedFile, uploadedFile.name)

            // Build combined audit JSON from comp1 + comp2 results
            const combinedAudit: any = { elements: [] }
            if (comp1Result?.violations) {
                combinedAudit.elements.push(
                    ...comp1Result.violations.map((v: any) => ({
                        ...v,
                        source: 'comp1_ai_audit',
                        status: v.violated ? 'FAIL' : 'PASS',
                    }))
                )
            }
            if (comp2Result?.components) {
                combinedAudit.elements.push(
                    ...comp2Result.components.map((c: any) => ({
                        ...c,
                        source: 'comp2_element_audit',
                        status: c.similarity_score < 50 ? 'FAIL' : 'PASS',
                        issues: c.similarity_score < 50 ? [{ desc: `Low similarity: ${c.similarity_score}% for ${c.class}` }] : [],
                    }))
                )
            }

            if (combinedAudit.elements.length > 0) {
                const jsonBlob = new Blob([JSON.stringify(combinedAudit)], { type: 'application/json' })
                enhanceFormData.append('audit_json', jsonBlob, 'audit_data.json')
            }

            const enhanceRes = await fetch('http://localhost:8000/feedback/generate', {
                method: 'POST',
                body: enhanceFormData,
            })

            if (!enhanceRes.ok) {
                const errData = await enhanceRes.json()
                throw new Error(errData.detail || errData.error || 'Failed to generate improved UI.')
            }

            const data = await enhanceRes.json()
            setResults(data)
            setPageStep('results')
        } catch (err: any) {
            console.error('Combined analysis error:', err)
            setError(err.message || 'An unexpected error occurred.')
            setPageStep('selection')
        }
    }

    // ─── PROCESSING STEP ───
    if (pageStep === 'processing') {
        return (
            <div className="page-container page-enter">
                <div className="spinner-container">
                    <div className="spinner" />
                    <div className="spinner-text">UI is Processing</div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', marginTop: '0.5rem' }}>
                        {processingStatus}
                    </p>
                </div>
            </div>
        )
    }

    // ─── RESULTS STEP (Comp3 output) ───
    if (pageStep === 'results' && results) {
        return (
            <div className="page-container page-enter">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button onClick={onBack} className="back-button-circle" title="Back to Home">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>Enhancement Results</h1>
                </div>

                <div className="comparison-view" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                    {/* Input Image */}
                    <div>
                        <h3 style={{ marginBottom: '0.75rem', fontWeight: 700 }}>Input Interface</h3>
                        <div style={{ borderRadius: '8px', overflow: 'hidden', border: '2px solid var(--border-light)', background: '#f9f9fb' }}>
                            {previewUrl && (
                                <img src={previewUrl} alt="Input UI" style={{ width: '100%', display: 'block' }} />
                            )}
                        </div>
                    </div>

                    {/* Output Image — Phase 6 if available, else Phase 3 */}
                    <div>
                        <h3 style={{ marginBottom: '0.75rem', fontWeight: 700 }}>
                            {results.images.phase6_generated ? '✨ AI-Generated Improved UI' : 'Enhanced Output'}
                        </h3>
                        <div style={{ borderRadius: '8px', overflow: 'hidden', border: `2px solid ${results.images.phase6_generated ? 'var(--primary-color, #7C4DFF)' : 'var(--green-accent, #4CAF50)'}`, background: '#f9f9fb' }}>
                            <img
                                src={`http://localhost:8000${results.images.phase6_generated || results.images.phase3_synthesis}`}
                                alt="Enhanced UI"
                                style={{ width: '100%', display: 'block' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Annotated Phase Images */}
                <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ fontWeight: 700, marginBottom: '1rem' }}>Detailed Analysis</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div>
                            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#dc3232' }}>Phase 1: Error Fixes</p>
                            <img src={`http://localhost:8000${results.images.phase1_technical}`} alt="Phase 1" style={{ width: '100%', borderRadius: '6px', border: '1px solid var(--border-light)' }} />
                        </div>
                        <div>
                            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#3282dc' }}>Phase 2: Improvements</p>
                            <img src={`http://localhost:8000${results.images.phase2_aesthetic}`} alt="Phase 2" style={{ width: '100%', borderRadius: '6px', border: '1px solid var(--border-light)' }} />
                        </div>
                        <div>
                            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#28b45a' }}>Phase 3: Cross-Analysis</p>
                            <img src={`http://localhost:8000${results.images.phase3_synthesis}`} alt="Phase 3" style={{ width: '100%', borderRadius: '6px', border: '1px solid var(--border-light)' }} />
                        </div>
                    </div>
                </div>

                <button
                    className="btn btn-outline"
                    style={{ width: '100%' }}
                    onClick={() => {
                        setResults(null)
                        setUploadedFile(null)
                        setPreviewUrl(null)
                        setUploadProgress(0)
                        setPageStep('selection')
                    }}
                >
                    Analyze Another UI
                </button>
            </div>
        )
    }

    // ─── SELECTION STEP (default) ───
    const isUploadReady = uploadedFile && uploadProgress >= 100

    return (
        <div className="page-container page-enter">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <button onClick={onBack} className="back-button-circle" title="Back to Home">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <h1 className="page-heading" style={{ margin: 0 }}>Combined Analysis</h1>
            </div>
            <p className="page-subheading">Upload your UI and choose the analysis type</p>

            {error && (
                <div style={{ color: '#ef4444', marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '4px' }}>
                    {error}
                </div>
            )}

            {/* Radio Options */}
            {ANALYSIS_OPTIONS.map((opt) => (
                <div
                    key={opt.id}
                    className={`radio-option ${selected === opt.id ? 'selected' : ''}`}
                    onClick={() => setSelected(opt.id)}
                >
                    <div className="radio-option__dot" />
                    <div className="radio-option__info">
                        <div className="radio-option__title">{opt.title}</div>
                        <div className="radio-option__desc">{opt.desc}</div>
                    </div>
                </div>
            ))}

            {/* Image Upload Zone */}
            <div style={{ marginTop: '1.5rem' }}>
                <label style={{ fontWeight: 600, fontSize: 'var(--font-sm)', marginBottom: 'var(--space-2)', display: 'block' }}>Upload UI Screenshot</label>
                <div
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="upload-zone__icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                    </div>
                    <p className="upload-zone__text">
                        Drag & Drop or <span>Choose file</span> to upload
                    </p>
                    <p className="upload-zone__formats">png, jpg, jpeg</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpeg,.jpg"
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                </div>
            </div>

            {/* Upload Progress */}
            {uploadedFile && (
                <div className="file-progress mt-6">
                    <div className="file-progress__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <rect width="24" height="24" rx="4" fill="#7C4DFF" fillOpacity="0.1" />
                            <path d="M7 7h10v10H7z" fill="#7C4DFF" fillOpacity="0.3" />
                        </svg>
                    </div>
                    <div className="file-progress__info">
                        <div className="file-progress__name">{uploadedFile.name}</div>
                        <div className="file-progress__meta">
                            {(uploadedFile.size / 1024 / 1024).toFixed(1)}MB • {uploadProgress >= 100 ? 'Ready' : 'Processing…'}
                        </div>
                        <div className="file-progress__bar">
                            <div className="file-progress__bar-fill" style={{ width: `${uploadProgress}%` }} />
                        </div>
                    </div>
                    <div className="file-progress__percent">{Math.round(uploadProgress)}%</div>
                </div>
            )}

            {/* Image Preview */}
            {isUploadReady && previewUrl && (
                <div style={{ marginTop: '1.5rem', border: '2px dashed var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '1rem' }}>
                    <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Preview</h3>
                    <div style={{ background: '#f5f5f5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', maxHeight: 300 }}>
                        <img
                            src={previewUrl}
                            alt="Uploaded UI Preview"
                            style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8 }}
                        />
                    </div>
                </div>
            )}

            {/* Start Analysis Button */}
            <div className="footer-actions" style={{ marginTop: '1.5rem' }}>
                <button
                    className="btn btn-primary btn-primary-lg shadow-glow"
                    style={{
                        width: '100%', maxWidth: 400,
                        opacity: isUploadReady ? 1 : 0.5,
                        cursor: isUploadReady ? 'pointer' : 'not-allowed',
                    }}
                    onClick={handleStartAnalysis}
                    disabled={!isUploadReady}
                >
                    Start Analysis
                </button>
            </div>
        </div>
    )
}

import { useState, useRef, useCallback, useEffect } from 'react'

interface AuditComponent {
    class: string
    confidence: number
    bbox: number[]
    similarity_score: number
    matched_expert: string
}

interface AuditResult {
    report_id: string
    overall_score: number
    grade: string
    total_components: number
    components: AuditComponent[]
    report_image_url: string
    error?: string
}

type AuditStep = 'upload' | 'uploaded' | 'processing' | 'results'

interface ElementAuditPageProps {
    onBack: () => void;
    onNext?: (result: AuditResult, imageUrl: string | null) => void;
    initialImageUrl?: string | null;
}

export default function ElementAuditPage({ onBack, onNext, initialImageUrl }: ElementAuditPageProps) {
    const [category, setCategory] = useState('universal')
    const [auditStep, setAuditStep] = useState<AuditStep>('upload')
    const [result, setResult] = useState<AuditResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
    const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(initialImageUrl || null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const simulateUpload = useCallback((file: File) => {
        const imageUrl = URL.createObjectURL(file)
        setPreviewUrl(imageUrl)
        setSelectedFile(file)
        setUploadedFileName(file.name)
        setUploadedFileSize(`${(file.size / 1024 / 1024).toFixed(1)}MB`)
        setUploadProgress(0)
        setError(null)
        setAuditStep('uploaded')

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

    const handleProcessAudit = useCallback(async (fileToAudit?: File | string) => {
        const source = fileToAudit || selectedFile || previewUrl;
        if (!source) return;

        setAuditStep('processing')
        setError(null)

        const formData = new FormData()

        if (typeof source === 'string') {
            // If it's a URL (blob), we need to fetch it first to send as a file
            try {
                const response = await fetch(source);
                const blob = await response.blob();
                formData.append('file', blob, 'design.png');
            } catch (err) {
                console.error('Failed to fetch initial image:', err);
                setError('Failed to load initial image.');
                setAuditStep('upload');
                return;
            }
        } else {
            formData.append('file', source)
        }

        try {
            const response = await fetch('http://localhost:8000/audit', {
                method: 'POST',
                body: formData,
            })
            const data: AuditResult = await response.json()

            if (data.error) {
                setError(data.error)
                setAuditStep('uploaded')
                return
            }

            setResult(data)
            setAuditStep('results')
        } catch (err) {
            console.error('Element audit failed:', err)
            setError('Audit failed. Please ensure the server is running on port 8000.')
            setAuditStep('uploaded')
        }
    }, [selectedFile, previewUrl])

    // Handle initialImageUrl by setting it to preview state instead of auto-processing
    useEffect(() => {
        if (initialImageUrl) {
            setPreviewUrl(initialImageUrl);
            setUploadedFileName('design-from-previous-step.png');
            setUploadedFileSize('---');
            setUploadProgress(100);
            setAuditStep('uploaded');
        }
    }, [initialImageUrl]);

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

    const getScoreColor = (score: number) => {
        if (score >= 70) return 'green'
        if (score >= 50) return 'amber'
        return 'red'
    }

    const getGradeClass = (grade: string) => {
        switch (grade) {
            case 'EXCELLENT': return 'grade--excellent'
            case 'GOOD': return 'grade--good'
            default: return 'grade--needs-work'
        }
    }

    // Upload view
    if (auditStep === 'upload') {
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
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
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>
                <p className="page-subheading">
                    Upload a UI screenshot to detect and score individual elements against expert design patterns.
                </p>

                <div className="toggle-tabs" style={{ marginBottom: '1.5rem' }}>
                    <select
                        className="dropdown"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-light)' }}
                    >
                        <option value="universal">Universal Format</option>
                        <option value="web">Web Application</option>
                        <option value="mobile">Mobile App</option>
                        <option value="dashboard">Dashboard</option>
                        <option value="ecommerce">E-commerce</option>
                    </select>
                </div>

                {error && (
                    <div className="audit-error">
                        <span>⚠️</span> {error}
                    </div>
                )}

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
        )
    }

    // Uploaded view — shows upload progress, image preview, and Process Interface button
    if (auditStep === 'uploaded') {
        const isUploadComplete = uploadProgress >= 100
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        onClick={() => {
                            setAuditStep('upload')
                            setPreviewUrl(null)
                            setSelectedFile(null)
                            setUploadProgress(0)
                            setUploadedFileName(null)
                            setUploadedFileSize(null)
                        }}
                        className="back-button-circle"
                        title="Back to Upload"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>

                <div className="toggle-tabs" style={{ marginBottom: '1.5rem' }}>
                    <select
                        className="dropdown"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid var(--border-light)' }}
                    >
                        <option value="universal">Universal Format</option>
                        <option value="web">Web Application</option>
                        <option value="mobile">Mobile App</option>
                        <option value="dashboard">Dashboard</option>
                        <option value="ecommerce">E-commerce</option>
                    </select>
                </div>

                {error && (
                    <div className="audit-error">
                        <span>⚠️</span> {error}
                    </div>
                )}

                {/* Upload Progress Bar */}
                {uploadedFileName && (
                    <div className="file-progress mt-6">
                        <div className="file-progress__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <rect width="24" height="24" rx="4" fill="#7C4DFF" fillOpacity="0.1" />
                                <path d="M7 7h10v10H7z" fill="#7C4DFF" fillOpacity="0.3" />
                            </svg>
                        </div>
                        <div className="file-progress__info">
                            <div className="file-progress__name">{uploadedFileName}</div>
                            <div className="file-progress__meta">
                                {uploadedFileSize} • {isUploadComplete ? 'Complete' : '1 minute left'}
                            </div>
                            <div className="file-progress__bar">
                                <div
                                    className="file-progress__bar-fill"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                        <div className="file-progress__percent">{Math.round(uploadProgress)}%</div>
                    </div>
                )}

                {/* Image Preview */}
                {isUploadComplete && previewUrl && (
                    <div style={{ marginTop: '2rem', border: '2px dashed var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '1rem' }}>
                        <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Preview</h3>
                        <div style={{
                            background: '#f5f5f5',
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            maxHeight: 350
                        }}>
                            <img
                                src={previewUrl}
                                alt="Uploaded UI Preview"
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: 350,
                                    objectFit: 'contain',
                                    borderRadius: 8
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Process Interface Button */}
                <div className="footer-actions">
                    <button
                        className="btn btn-primary btn-primary-lg"
                        onClick={() => handleProcessAudit()}
                        style={{ opacity: isUploadComplete ? 1 : 0.5, width: '100%', maxWidth: 400 }}
                        disabled={!isUploadComplete}
                    >
                        Process Interface
                    </button>
                </div>
            </div>
        )
    }

    // Processing view
    if (auditStep === 'processing') {
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>
                <div className="spinner-container">
                    <div className="spinner" />
                    <div className="spinner-text">Analyzing UI Elements</div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                        Detecting components and scoring against expert patterns…
                    </p>
                </div>
            </div>
        )
    }

    // Results view
    if (!result) return null

    return (
        <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
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
                <h1 className="page-heading" style={{ margin: 0 }}>Audit Results</h1>
            </div>

            {/* Overall Score Section */}
            <div className="audit-overview">
                <div className={`grade-badge ${getGradeClass(result.grade)}`}>
                    <span className="grade-badge__score">{result.overall_score}%</span>
                    <span className="grade-badge__label">{result.grade}</span>
                </div>
                <div className="audit-overview__stats">
                    <div className="stat-cards">
                        <div className="stat-card stat-card--blue">
                            <div className="stat-card__label">Components Found</div>
                            <div className="stat-card__value">{result.total_components}</div>
                        </div>
                        <div className={`stat-card ${result.overall_score >= 70 ? 'stat-card--green' : result.overall_score >= 50 ? 'stat-card--blue' : 'stat-card--red'}`}>
                            <div className="stat-card__label">Overall Score</div>
                            <div className="stat-card__value">{result.overall_score}%</div>
                        </div>
                        <div className="stat-card stat-card--green">
                            <div className="stat-card__label">Grade</div>
                            <div className="stat-card__value">{result.grade}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Annotated Report Image */}
            <div className="audit-report-image">
                <h3 style={{ marginBottom: 'var(--space-4)', fontWeight: 700 }}>Annotated Report</h3>
                <div className="audit-report-image__container">
                    <img
                        src={`http://localhost:8000${result.report_image_url}`}
                        alt="Annotated UI audit report"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                        }}
                    />
                </div>
            </div>

            {/* Per-Component Results */}
            <h3 style={{ marginTop: 'var(--space-8)', marginBottom: 'var(--space-4)', fontWeight: 700 }}>
                Detected Components ({result.components.length})
            </h3>
            <div className="audit-components">
                {result.components.map((comp, i) => (
                    <div key={i} className="audit-component-card">
                        <div className="audit-component-card__header">
                            <span className="audit-component-card__class">{comp.class}</span>
                            <span className={`audit-component-card__conf`}>
                                Conf: {(comp.confidence * 100).toFixed(1)}%
                            </span>
                        </div>
                        <div className="score-item" style={{ marginBottom: 0 }}>
                            <div className="score-item__header">
                                <span className="score-item__label" style={{ fontSize: 'var(--font-sm)' }}>
                                    Similarity Score
                                </span>
                                <span className={`score-item__value ${comp.similarity_score >= 70 ? 'good' : comp.similarity_score >= 50 ? 'medium' : 'bad'}`}>
                                    {comp.similarity_score}%
                                </span>
                            </div>
                            <div className="score-bar">
                                <div
                                    className={`score-bar__fill ${getScoreColor(comp.similarity_score)}`}
                                    style={{ width: `${comp.similarity_score}%` }}
                                />
                            </div>
                        </div>
                        <div className="audit-component-card__meta">
                            Matched: {comp.matched_expert}
                        </div>
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div className="footer-actions" style={{ marginTop: 'var(--space-8)', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        setResult(null)
                        setAuditStep('upload')
                        setPreviewUrl(null)
                        setSelectedFile(null)
                        setUploadProgress(0)
                        setUploadedFileName(null)
                        setUploadedFileSize(null)
                    }}
                >
                    Audit Another Screenshot
                </button>
                {onNext && (
                    <button
                        className="btn btn-primary btn-primary-lg shadow-glow"
                        onClick={() => onNext(result, previewUrl)}
                    >
                        Go to UI Enhancer →
                    </button>
                )}
            </div>
        </div>
    )
}

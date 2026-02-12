import { useState, useRef, useCallback } from 'react'

interface UploadPageProps {
    onBack: () => void;
    onProcess: (data: {
        fileName: string;
        imageUrl?: string;
        category: string;
    }) => void
}

export default function UploadPage({ onBack, onProcess }: UploadPageProps) {
    const [category, setCategory] = useState('universal')
    const [file, setFile] = useState<{ name: string; size: string; progress: number; imageUrl?: string } | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) {
            const imageUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined
            simulateUpload(f.name, `${(f.size / 1024 / 1024).toFixed(1)}MB`, imageUrl)
        }
    }, [])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (f) {
            const imageUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined
            simulateUpload(f.name, `${(f.size / 1024 / 1024).toFixed(1)}MB`, imageUrl)
        }
    }, [])

    const simulateUpload = (name: string, size: string, imageUrl?: string) => {
        setFile({ name, size, progress: 0, imageUrl })
        let progress = 0
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5
            if (progress >= 100) {
                progress = 100
                clearInterval(interval)
            }
            setFile(prev => prev ? { ...prev, progress } : null)
        }, 300)
    }

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
                <h1 className="page-heading" style={{ margin: 0 }}>Upload Your Interface Design</h1>
            </div>


            {/* Drag & Drop Zone */}
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
                <p className="upload-zone__formats">fig, zip, pdf, png, jpeg</p>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".fig,.zip,.pdf,.png,.jpeg,.jpg"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                />
            </div>

            {/* File Progress & Preview */}
            {file && (
                <div className="preview-container mt-8">
                    <h3 className="section-label mb-4">Design Preview</h3>

                    <div className="file-progress mb-6">
                        <div className="file-progress__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <rect width="24" height="24" rx="4" fill="#7C4DFF" fillOpacity="0.1" />
                                <path d="M7 7h10v10H7z" fill="#7C4DFF" fillOpacity="0.3" />
                            </svg>
                        </div>
                        <div className="file-progress__info">
                            <div className="file-progress__name">{file.name}</div>
                            <div className="file-progress__meta">{file.size} • {file.progress < 100 ? 'Processing...' : 'Ready for Audit'}</div>
                            <div className="file-progress__bar">
                                <div className="file-progress__bar-fill" style={{ width: `${file.progress}%` }} />
                            </div>
                        </div>
                        <div className="file-progress__percent">{Math.round(file.progress)}%</div>
                    </div>

                    <div className="design-preview-card">
                        {file?.imageUrl && file.progress >= 100 ? (
                            <img src={file.imageUrl} alt="Preview" className="design-preview-img" />
                        ) : null}
                    </div>
                </div>
            )}

            {/* Process Button */}
            <div className="footer-actions mt-12">
                <button
                    className="btn btn-primary btn-primary-lg shadow-glow"
                    onClick={() => onProcess({
                        fileName: file?.name || 'Design Upload',
                        imageUrl: file?.imageUrl,
                        category
                    })}
                    disabled={!(file && file.progress >= 100)}
                    style={{
                        opacity: (file && file.progress >= 100) ? 1 : 0.5,
                        cursor: (file && file.progress >= 100) ? 'pointer' : 'not-allowed'
                    }}
                >
                    Process Interfaces
                </button>
            </div>
        </div>
    )
}

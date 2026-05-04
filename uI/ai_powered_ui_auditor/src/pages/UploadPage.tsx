import { useState, useRef, useCallback } from 'react'
import { RULE_CATEGORIES } from '../constants/ruleCategories'

interface UploadPageProps {
    onBack: () => void;
    onProcess: (data: {
        fileName: string;
        imageUrl?: string;
        category: string;
        // Pass the raw File object so App.tsx can build FormData correctly
        file?: File;
    }) => void
}

export default function UploadPage({ onBack, onProcess }: UploadPageProps) {
    const [category, setCategory]           = useState('universal')
    const [dropdownOpen, setDropdownOpen]   = useState(false)
    const [rawFile, setRawFile]             = useState<File | null>(null)
    const [file, setFile]                   = useState<{
        name: string; size: string; progress: number; imageUrl?: string
    } | null>(null)
    const [dragOver, setDragOver]           = useState(false)
    const fileInputRef                      = useRef<HTMLInputElement>(null)

    const selectedCat = RULE_CATEGORIES.find(c => c.value === category) || RULE_CATEGORIES[0]

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) processFile(f)
    }, [])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (f) processFile(f)
    }, [])

    const processFile = (f: File) => {
        setRawFile(f)
        const imageUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined
        const sizeMB   = (f.size / 1024 / 1024).toFixed(1)
        setFile({ name: f.name, size: `${sizeMB}MB`, progress: 0, imageUrl })
        let progress = 0
        const iv = setInterval(() => {
            progress += Math.random() * 20 + 5
            if (progress >= 100) { progress = 100; clearInterval(iv) }
            setFile(prev => prev ? { ...prev, progress } : null)
        }, 250)
    }

    const canProcess = !!(file && file.progress >= 100 && rawFile)

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <button onClick={onBack} className="back-button-circle" title="Back to Home">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12" />
                        <polyline points="12 19 5 12 12 5" />
                    </svg>
                </button>
                <h1 className="page-heading" style={{ margin: 0 }}>Upload Your Interface Design</h1>
            </div>

            {/* ── Rule Category Dropdown ─────────────────────────────── */}
            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{
                    display: 'block', marginBottom: '0.5rem',
                    fontSize: '0.85rem', fontWeight: 600,
                    color: 'var(--text-secondary, #888)'
                }}>
                    Rule Category / Design Platform
                </label>

                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setDropdownOpen(o => !o)}
                        style={{
                            width: '100%',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            background: 'var(--surface, #1a1a2e)',
                            border: '1.5px solid var(--border, #333)',
                            borderRadius: '12px',
                            cursor: 'pointer', color: 'inherit',
                            fontSize: '0.95rem',
                        }}
                    >
                        <span>
                            <span style={{ marginRight: '0.5rem' }}>{selectedCat.icon}</span>
                            <strong>{selectedCat.label}</strong>
                            <span style={{
                                marginLeft: '0.75rem', fontSize: '0.8rem',
                                color: 'var(--text-secondary, #888)'
                            }}>
                                — {selectedCat.description}
                            </span>
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2"
                             style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </button>

                    {dropdownOpen && (
                        <div style={{
                            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                            background: 'var(--surface, #1a1a2e)',
                            border: '1.5px solid var(--border, #333)',
                            borderRadius: '12px', zIndex: 100,
                            maxHeight: '320px', overflowY: 'auto',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}>
                            {RULE_CATEGORIES.map(cat => (
                                <button
                                    key={cat.value}
                                    onClick={() => { setCategory(cat.value); setDropdownOpen(false) }}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center',
                                        padding: '0.65rem 1rem', border: 'none', cursor: 'pointer',
                                        background: cat.value === category
                                            ? 'var(--accent-soft, rgba(124,77,255,0.15))'
                                            : 'transparent',
                                        color: 'inherit', textAlign: 'left',
                                        borderBottom: '1px solid var(--border, #222)',
                                        fontSize: '0.9rem',
                                    }}
                                >
                                    <span style={{ marginRight: '0.6rem', fontSize: '1.1rem' }}>{cat.icon}</span>
                                    <span>
                                        <strong>{cat.label}</strong>
                                        <span style={{
                                            marginLeft: '0.5rem', fontSize: '0.78rem',
                                            color: 'var(--text-secondary, #888)'
                                        }}>
                                            {cat.description}
                                        </span>
                                    </span>
                                    {cat.value === category && (
                                        <svg style={{ marginLeft: 'auto' }} width="14" height="14"
                                             viewBox="0 0 24 24" fill="none" stroke="#7C4DFF" strokeWidth="3">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Drag & Drop Zone ───────────────────────────────────── */}
            <div
                className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="upload-zone__icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2">
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

            {/* ── File preview ──────────────────────────────────────── */}
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
                            <div className="file-progress__meta">
                                {file.size} • {file.progress < 100
                                    ? 'Processing...'
                                    : `Ready — ${selectedCat.icon} ${selectedCat.label} rules`}
                            </div>
                            <div className="file-progress__bar">
                                <div className="file-progress__bar-fill"
                                     style={{ width: `${file.progress}%` }} />
                            </div>
                        </div>
                        <div className="file-progress__percent">{Math.round(file.progress)}%</div>
                    </div>

                    {file.imageUrl && file.progress >= 100 && (
                        <div className="design-preview-card">
                            <img src={file.imageUrl} alt="Preview" className="design-preview-img" />
                        </div>
                    )}
                </div>
            )}

            {/* ── Process Button ─────────────────────────────────────── */}
            <div className="footer-actions mt-12">
                <button
                    className="btn btn-primary btn-primary-lg shadow-glow"
                    onClick={() => onProcess({
                        fileName: file?.name || 'Design Upload',
                        imageUrl: file?.imageUrl,
                        category,
                        file: rawFile ?? undefined,
                    })}
                    disabled={!canProcess}
                    style={{ opacity: canProcess ? 1 : 0.5, cursor: canProcess ? 'pointer' : 'not-allowed' }}
                >
                    {canProcess
                        ? `Audit with ${selectedCat.icon} ${selectedCat.label} Rules`
                        : 'Process Interfaces'}
                </button>
            </div>
        </div>
    )
}
import { useState } from 'react'

interface AnalysisSelectionProps {
    uploadedFileName: string | null
    uploadedImageUrl: string | null
    onStartAnalysis: (option: 'rules' | 'elements' | 'all') => void
}

const OPTIONS = [
    {
        id: 'rules' as const,
        title: 'UI & Violation Rules set',
        desc: 'Capture UI Interactions, Clicks, Scrolls and Navigations',
    },
    {
        id: 'elements' as const,
        title: 'UI & Element Score',
        desc: 'Capture UI Interactions, Clicks, Scrolls and Navigations',
    },
    {
        id: 'all' as const,
        title: 'UI | Violation Rules set | Element Score',
        desc: 'Analyse Facial expressions, eye Movement and Emotions',
    },
]

export default function AnalysisSelection({ uploadedFileName, uploadedImageUrl, onStartAnalysis }: AnalysisSelectionProps) {
    const [selected, setSelected] = useState<'rules' | 'elements' | 'all'>('rules')

    return (
        <div>
            <h1 className="page-heading">Upload Your Interface Design</h1>
            <p className="page-subheading">Choose you want</p>

            {/* Radio Options */}
            {OPTIONS.map((opt) => (
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

            {/* Start Analysis Button */}
            <div className="text-center mt-6">
                <button
                    className="btn btn-primary btn-primary-lg"
                    style={{ width: '100%', maxWidth: 400 }}
                    onClick={() => onStartAnalysis(selected)}
                >
                    Start Analysis
                </button>
            </div>

            {/* Preview — shows the uploaded file */}
            <div style={{
                marginTop: '2rem',
                border: '2px dashed var(--border-light)',
                borderRadius: 'var(--radius-lg)',
                padding: '1rem',
            }}>
                <h3 style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Preview</h3>

                {uploadedImageUrl ? (
                    <div style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid var(--border-light)',
                    }}>
                        <img
                            src={uploadedImageUrl}
                            alt={uploadedFileName || 'Uploaded UI'}
                            style={{ width: '100%', display: 'block' }}
                        />
                    </div>
                ) : (
                    /* Fallback mock preview (project management table) */
                    <div style={{
                        background: '#f9f9fb',
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid var(--border-light)',
                    }}>
                        <div style={{ padding: '0.5rem' }}>
                            {/* Header bar */}
                            <div style={{
                                display: 'flex', gap: 6, alignItems: 'center',
                                padding: '6px 10px', background: '#fff', borderRadius: 6,
                                marginBottom: 4, fontSize: 11,
                            }}>
                                <span style={{ fontSize: 14 }}>📋</span>
                                <div style={{
                                    background: 'var(--green-accent)', color: 'white',
                                    padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                                }}>+ Add Project</div>
                                <input style={{
                                    flex: 1, border: '1px solid #e0e0e0', borderRadius: 4,
                                    padding: '3px 6px', fontSize: 10,
                                }} placeholder="Project or company" readOnly />
                                <span style={{ fontSize: 10, color: '#888' }}>≡ List ▾ 👤 👥 📊 ◇ Active ▾ ⋮</span>
                            </div>

                            {/* Table */}
                            <div style={{ background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                                    padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#888',
                                    borderBottom: '1px solid #eee',
                                }}>
                                    <span>Ow...</span><span>Company</span><span>End Date</span><span>Start Date</span><span>Tags ⓘ</span>
                                </div>
                                {[
                                    { company: 'ABC Ltd', tag: 'Reviews ✕' },
                                    { icon: true, company: 'Teamwork', end: 'May 5 2022' },
                                    { company: 'Aimbu' },
                                    { company: 'Teamwork' },
                                    { company: 'Client 2', end: 'Dec 17 2021' },
                                    { icon: true, company: 'Design Par...', end: 'Jan 1 2023' },
                                    { icon: true, company: 'Teamwork' },
                                    { icon: true, company: 'Design Par...', end: 'Nov 25 2021' },
                                ].map((row, i) => (
                                    <div key={i} style={{
                                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                                        padding: '4px 10px', fontSize: 10,
                                        borderBottom: '1px solid #f5f5f5', alignItems: 'center', color: '#555',
                                    }}>
                                        <span>{row.icon ? <span style={{ fontSize: 14, color: '#5C6BC0' }}>🟣</span> : '—'}</span>
                                        <span>{row.company}</span>
                                        <span>{row.end || '—'}</span>
                                        <span>—</span>
                                        <span>{row.tag && (
                                            <span style={{
                                                background: '#4CAF50', color: 'white',
                                                padding: '1px 6px', borderRadius: 3, fontSize: 8,
                                            }}>{row.tag}</span>
                                        )}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Context menu overlay */}
                            <div style={{
                                position: 'relative', float: 'right', marginTop: '-120px',
                                marginRight: 10, background: 'white', borderRadius: 6,
                                boxShadow: '0 2px 12px rgba(0,0,0,0.12)', width: 160,
                                overflow: 'hidden', zIndex: 2,
                            }}>
                                <div style={{ display: 'flex' }}>
                                    <div style={{
                                        flex: 1, padding: '5px 10px', background: '#5C6BC0',
                                        color: 'white', fontSize: 10, fontWeight: 600,
                                    }}>Manage Project</div>
                                    <div style={{ flex: 1, padding: '5px 10px', fontSize: 10, color: '#777' }}>Quick Add</div>
                                </div>
                                {['✏️ Edit project details', '📋 Copy', '💾 Save as Template', '📁 Archive', '+ More Options ›', '✕ Delete'].map((item, i) => (
                                    <div key={i} style={{ padding: '4px 10px', fontSize: 10, color: '#444' }}>{item}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {uploadedFileName && (
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                        {uploadedFileName}
                    </p>
                )}
            </div>
        </div>
    )
}

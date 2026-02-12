import { useState } from 'react'

interface ElementInteractionProps {
    step: string
    onImportNew: () => void
    onElementInteraction: () => void
    onGetScore: () => void
    onNext: () => void
}

const ELEMENTS = [
    { name: 'Primary Buttons', score: 70, color: 'green' as const },
    { name: 'Input Fields', score: 40, color: 'red' as const },
    { name: 'Navigation Components', score: 90, color: 'green' as const },
    { name: 'Image Icons', score: 60, color: 'green' as const },
]

const ANNOTATIONS = [
    { top: '8%', left: '5%', width: '90%', height: '8%', score: 70, label: 'Header' },
    { top: '18%', left: '5%', width: '60%', height: '7%', score: 40, label: 'Search' },
    { top: '28%', left: '5%', width: '90%', height: '50%', score: 90, label: 'Table' },
    { top: '30%', left: '65%', width: '30%', height: '35%', score: 40, label: 'Menu' },
]

export default function ElementInteraction({ step, onImportNew, onElementInteraction, onGetScore, onNext }: ElementInteractionProps) {
    // Notice Modal
    if (step === 'notice-modal') {
        return (
            <div className="modal-overlay">
                <div className="modal">
                    <h2 className="modal__title">Notice</h2>
                    <p className="modal__body">
                        You can choose to provide these details now to personalise your experience, or simply skip this step for now.
                    </p>
                    <div className="modal__actions">
                        <button className="btn btn-primary btn-primary-lg" onClick={onImportNew}>Import new UI</button>
                        <button className="btn btn-outline btn-primary-lg" onClick={onElementInteraction}>Element Interaction</button>
                    </div>
                </div>
            </div>
        )
    }

    // Loading
    if (step === 'element-loading') {
        return (
            <div className="spinner-container">
                <div className="spinner" />
                <div className="spinner-text">
                    Loading<br />Element Interaction
                </div>
            </div>
        )
    }

    // Element Score
    if (step === 'element-score') {
        return (
            <div style={{ maxWidth: 700, margin: '0 auto' }}>
                <h1 className="page-heading text-center">Element Score</h1>

                <div style={{ padding: '2rem 0' }}>
                    {ELEMENTS.map((el) => (
                        <div className="score-item" key={el.name}>
                            <div className="score-item__header">
                                <span className="score-item__label">{el.name}</span>
                                <span className={`score-item__value ${el.score >= 70 ? 'good' : el.score >= 50 ? 'medium' : 'bad'}`}>
                                    {el.score}%
                                </span>
                            </div>
                            <div className="score-bar">
                                <div
                                    className={`score-bar__fill ${el.score >= 70 ? 'green' : el.score >= 50 ? 'amber' : 'red'}`}
                                    style={{ width: `${el.score}%` }}
                                />
                            </div>
                        </div>
                    ))}

                    <div className="overall-score">
                        <span className="overall-score__label">Overall Score</span>
                        <span className="overall-score__value" style={{ color: 'var(--yellow-accent)' }}>65%</span>
                    </div>
                    <div className="score-bar" style={{ marginTop: '0.5rem' }}>
                        <div className="score-bar__fill amber" style={{ width: '65%' }} />
                    </div>
                </div>

                <div className="text-center mt-6">
                    <button className="btn btn-primary btn-primary-lg">Get Detailed Report</button>
                </div>

                <hr className="divider" />
                <div className="footer-actions">
                    <button className="btn btn-primary btn-primary-lg" onClick={onNext}>Next</button>
                </div>
            </div>
        )
    }

    // Annotated UI
    return (
        <div>
            <h1 className="page-heading">Element Interaction</h1>

            <div className="annotated-image" style={{ position: 'relative', background: '#f5f5f5', minHeight: 450, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                {/* Mock UI Screenshot */}
                <div style={{ padding: '0.5rem' }}>
                    {/* Header bar */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: '#fff', borderRadius: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>)1)</span>
                        <div style={{ background: 'var(--green-accent)', color: 'white', padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>+ Add Project</div>
                        <input style={{ flex: 1, border: '1px solid #ddd', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} placeholder="Project or company" />
                        <span style={{ fontSize: 12 }}>≡ List ▾</span>
                        <span style={{ fontSize: 12 }}>👤 👥 📊 ◇ Active ▾ ≡ ⋮</span>
                    </div>

                    {/* Table with annotations */}
                    <div style={{ background: '#fff', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', padding: '8px 12px', borderBottom: '2px solid var(--red-high)', fontSize: 12, fontWeight: 600, color: '#666' }}>
                            <span>Ow...</span><span>Company</span><span>End Date</span><span>Start Date</span><span>Tags ⓘ</span>
                        </div>
                        {[
                            { company: 'ABC Ltd', tag: 'Reviews ✕' },
                            { icon: '🟣', company: 'Teamwork', end: 'May 5 2022' },
                            { company: 'Aimbu' },
                            { company: 'Teamwork' },
                            { company: 'Client 2', end: 'Dec 17 2021' },
                            { icon: '🟣', company: 'Design Par...', end: 'Jan 1 2023' },
                            { icon: '🟣', company: 'Teamwork' },
                            { icon: '🟣', company: 'Design Par...', end: 'Nov 25 2021' },
                        ].map((row, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontSize: 12, alignItems: 'center' }}>
                                <span>{row.icon ? <span style={{ fontSize: 16 }}>{row.icon}</span> : '—'}</span>
                                <span>{row.company}</span>
                                <span>{row.end || '—'}</span>
                                <span>—</span>
                                <span>{row.tag && <span style={{ background: '#4CAF50', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>{row.tag}</span>}</span>
                            </div>
                        ))}
                    </div>

                    {/* Score badges */}
                    <div style={{ position: 'absolute', top: '8%', right: '10%' }}>
                        <span className="annotation-badge green">70%</span>
                    </div>
                    <div style={{ position: 'absolute', top: '35%', right: '25%' }}>
                        <span className="annotation-badge" style={{ background: 'var(--red-high)' }}>40%</span>
                    </div>
                    <div style={{ position: 'absolute', top: '55%', right: '30%' }}>
                        <span className="annotation-badge green">90%</span>
                    </div>

                    {/* Red border annotations */}
                    <div style={{ position: 'absolute', top: '10%', left: '3%', width: '65%', height: '7%', border: '2px solid var(--red-high)', borderRadius: 4 }} />
                    <div style={{ position: 'absolute', top: '28%', left: '55%', width: '35%', height: '55%', border: '2px solid var(--red-high)', borderRadius: 4 }} />

                    {/* Context menu overlay */}
                    <div style={{ position: 'absolute', top: '30%', right: '10%', background: 'white', borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 0, width: 200, overflow: 'hidden' }}>
                        <div style={{ display: 'flex' }}>
                            <div style={{ flex: 1, padding: '8px 16px', background: '#1565C0', color: 'white', fontSize: 12, fontWeight: 600 }}>Manage Project</div>
                            <div style={{ flex: 1, padding: '8px 16px', fontSize: 12, color: '#666' }}>Quick Add</div>
                        </div>
                        {['✏️ Edit project details', '📋 Copy', '💾 Save as Template', '📁 Archive', '+ More Options ›', '✕ Delete'].map((item, i) => (
                            <div key={i} style={{ padding: '6px 16px', fontSize: 12, color: '#333', borderTop: i === 0 ? '1px solid #eee' : 'none' }}>{item}</div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="footer-actions">
                <button className="btn btn-primary btn-primary-lg" onClick={onGetScore}>Get Score</button>
            </div>
        </div>
    )
}

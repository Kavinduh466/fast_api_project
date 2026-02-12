import { useState, useEffect } from 'react'

interface VioletRulesPageProps {
    step: 'violet-rules' | 'violet-accuracy'
    fileName: string | null
    auditResult?: any
    onDone: () => void
    onNext: () => void
}

const MOCK_RULES = [
    { id: 1, title: 'Visual Hierarchy', description: 'Use size, color, and weight to show importance. The most important thing should be the easiest to see.', violated: true },
    { id: 2, title: 'Contrast Ratio', description: 'Ensure enough contrast between text and background. Aim for at least 4.5:1 for normal text to maintain accessibility.', violated: true },
    { id: 3, title: 'Rule of Proximity', description: 'Place related items close together (e.g., a label next to its input field) so users perceive them as a group.', violated: false },
    { id: 4, title: 'The 60-30-10 Rule', description: 'For color, use a primary color for 60%, a secondary for 30%, and an accent color (like for buttons) for 10%.', violated: true },
    { id: 5, title: 'Visibility of System Status', description: "Always tell the user what's happening. If something is loading, show a progress bar or spinner.", violated: false },
    { id: 6, title: 'User Control & Freedom', description: 'Always give users an "emergency exit." Let them easily undo, redo, or cancel an action.', violated: true },
]

export default function VioletRulesPage({ step, fileName, auditResult, onDone, onNext }: VioletRulesPageProps) {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)

    // Use dynamic results if available. Only fallback to mocks if NO audit has been run.
    const hasRunAudit = !!auditResult;
    const currentRules = hasRunAudit 
        ? (auditResult.violations || []) 
        : MOCK_RULES

    const violatedRules = currentRules.filter((r: any) => r.violated)
    const accuracy = auditResult?.summary?.score ?? 
        Math.round((currentRules.filter((r: any) => !r.violated).length / currentRules.length) * 100)

    const displayRules = step === 'violet-accuracy' ? violatedRules : currentRules

    // Track which rules the user agrees with (by rule id)
    const [agreedRuleIds, setAgreedRuleIds] = useState<Set<number>>(new Set())

    // Pre-select all violated rules on initial load
    useEffect(() => {
        const violatedIds = new Set<number>(
            currentRules.filter((r: any) => r.violated).map((r: any) => r.id)
        )
        setAgreedRuleIds(violatedIds)
    }, [auditResult])

    const toggleRule = (ruleId: number) => {
        setAgreedRuleIds(prev => {
            const next = new Set(prev)
            if (next.has(ruleId)) {
                next.delete(ruleId)
            } else {
                next.add(ruleId)
            }
            return next
        })
    }

    const submitFeedbackAndNavigate = async (navigateFn: () => void) => {
        if (feedbackSubmitted || displayRules.length === 0) {
            navigateFn()
            return
        }
        setIsSubmitting(true)
        try {
            const items = displayRules.map((rule: any) => ({
                rule_name: rule.rule || rule.title.toLowerCase().replace(/ /g, '_'),
                feedback: agreedRuleIds.has(rule.id) ? 1 : -1
            }))

            await fetch('http://localhost:8000/audit/feedback/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profile: auditResult?.meta?.profile || 'universal',
                    items
                })
            })
            setFeedbackSubmitted(true)
        } catch (error) {
            console.error('Failed to submit batch feedback:', error)
        } finally {
            setIsSubmitting(false)
            navigateFn()
        }
    }

    const handleExport = async () => {
        try {
            const response = await fetch('http://localhost:8000/audit/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(auditResult)
            })
            const blob = await response.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `audit_report_${Date.now()}.md`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Export failed:', error)
            alert('Export failed. Please ensure the server is running.')
        }
    }

    const agreedCount = displayRules.filter((r: any) => agreedRuleIds.has(r.id)).length

    return (
        <div style={{ paddingBottom: '100px' }}>
            <h1 className="page-heading">
                {step === 'violet-rules' ? 'Audited Rules' : 'Violated Rules'}
            </h1>

            {/* Instruction text */}
            <p style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--font-sm)',
                marginBottom: 'var(--space-6)',
                lineHeight: 1.6
            }}>
                Review the detected rules below. <strong>Check</strong> rules you agree with, <strong>uncheck</strong> rules you disagree with, then submit your feedback.
            </p>

            {/* Rule Cards with Checkboxes */}
            {displayRules.length > 0 ? (
                displayRules.map((rule: any) => {
                    const isAgreed = agreedRuleIds.has(rule.id)
                    return (
                        <div
                            key={rule.id}
                            className={`rule-card ${!rule.violated ? 'rule-card--passed' : ''}`}
                            onClick={() => toggleRule(rule.id)}
                            style={{
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 'var(--space-4)',
                                border: isAgreed ? '2px solid var(--purple-primary, #7C4DFF)' : '2px solid transparent',
                                transition: 'border-color 0.2s ease, background 0.2s ease',
                            }}
                        >
                            {/* Checkbox */}
                            <div
                                style={{
                                    minWidth: '24px',
                                    height: '24px',
                                    borderRadius: '6px',
                                    border: isAgreed ? 'none' : '2px solid var(--text-muted, #888)',
                                    background: isAgreed ? 'var(--purple-primary, #7C4DFF)' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginTop: '2px',
                                    transition: 'all 0.2s ease',
                                    flexShrink: 0
                                }}
                            >
                                {isAgreed && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </div>
                            {/* Rule Content */}
                            <div style={{ flex: 1 }}>
                                <div className="rule-card__title">
                                    {rule.violated ? '❌ ' : '✅ '}
                                    {rule.title || rule.rule}
                                </div>
                                <div className="rule-card__description">{rule.description || rule.desc}</div>
                            </div>
                        </div>
                    )
                })
            ) : hasRunAudit && (
                <div className="card card-green text-center" style={{ padding: 'var(--space-12)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>✅</div>
                    <h3 className="feature-card__title">No Violations Found</h3>
                    <p className="feature-card__desc">The AI model analyzed the interface and found no rule violations. Great job!</p>
                </div>
            )}


            {/* Accuracy Section (step 2) */}
            {step === 'violet-accuracy' && (
                <div className="accuracy-section">
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <span className="accuracy-section__label">Total accuracy</span>
                        <span className="accuracy-section__value">{accuracy}%</span>
                    </div>
                    <div className="export-row">
                        <span className="export-row__label">Export Detailed Report</span>
                        <button className="btn btn-primary" onClick={handleExport}>Export Report</button>
                    </div>
                </div>
            )}

            <hr className="divider" />

            {/* Footer */}
            <div className="footer-actions">
                {step === 'violet-rules' ? (
                    <button
                        className="btn btn-dark btn-primary-lg"
                        onClick={() => submitFeedbackAndNavigate(onDone)}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Submitting...' : 'Done'}
                    </button>
                ) : (
                    <button
                        className="btn btn-primary btn-primary-lg"
                        onClick={() => submitFeedbackAndNavigate(onNext)}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Submitting...' : 'NEXT'}
                    </button>
                )}
            </div>

            {/* Sticky Bottom Feedback Bar */}
            {displayRules.length > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(135deg, rgba(20, 20, 30, 0.98), rgba(30, 25, 50, 0.98))',
                    backdropFilter: 'blur(12px)',
                    borderTop: '1px solid rgba(124, 77, 255, 0.3)',
                    padding: '16px 32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    zIndex: 1000,
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.3)'
                }}>
                    <div style={{
                        background: 'rgba(124, 77, 255, 0.15)',
                        borderRadius: '8px',
                        padding: '6px 14px',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: 'var(--purple-primary, #7C4DFF)'
                    }}>
                        {agreedCount} / {displayRules.length}
                    </div>
                    <span style={{ color: 'var(--text-muted, #aaa)', fontSize: '14px' }}>
                        rules agreed
                    </span>
                    {feedbackSubmitted && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#4CAF50',
                            fontWeight: 600,
                            fontSize: '13px',
                            marginLeft: '8px'
                        }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Submitted
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

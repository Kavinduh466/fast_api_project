import { useState, useEffect } from 'react'

interface VioletRulesPageProps {
    step: 'violet-rules' | 'violet-accuracy'
    fileName: string | null
    auditResult?: any
    onDone: () => void
    onNext: () => void
}

function normaliseRule(r: any, index: number) {
    return {
        id:          index,
        rule_id:     r.rule_id   || r.rule   || `unknown-${index}`,
        title:       r.rule_name || r.title  || r.rule || 'Unknown Rule',
        description: r.description || r.desc || '',
        violated:    r.violated  ?? false,
        source:      r.source    || 'metric',
        status:      r.status    || (r.violated ? 'pending' : 'view_only'),
    }
}

export default function VioletRulesPage({ step, fileName, auditResult, onDone, onNext }: VioletRulesPageProps) {
    const [isSubmitting, setIsSubmitting]           = useState(false)
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
    const [agreedRuleIds, setAgreedRuleIds]         = useState<Set<number>>(new Set())

    const hasRunAudit = !!auditResult

    const allRules = hasRunAudit
        ? (auditResult.violations || []).map(normaliseRule)
        : []

    // Violated rules = pending feedback
    // Passed rules   = view_only (shown but read-only, no feedback)
    const violatedRules = allRules.filter((r: any) => r.violated === true)
    const passedRules   = allRules.filter((r: any) => r.violated === false || r.violated === null)

    // step 1: show ALL rules (violated + passed)
    // step 2: show only violated
    const displayRules = step === 'violet-accuracy' ? violatedRules : allRules

    const accuracy = auditResult?.summary?.score ?? 100

    // Pre-select violated rules for feedback
    useEffect(() => {
        const violated = new Set<number>(
            allRules.filter((r: any) => r.violated === true).map((r: any) => r.id)
        )
        setAgreedRuleIds(violated)
        setFeedbackSubmitted(false)
    }, [auditResult])

    const toggleRule = (ruleId: number, isViolated: boolean) => {
        // Only allow toggling violated rules — passed rules are view-only
        if (!isViolated) return
        setAgreedRuleIds(prev => {
            const next = new Set(prev)
            next.has(ruleId) ? next.delete(ruleId) : next.add(ruleId)
            return next
        })
    }

    const submitFeedbackAndNavigate = async (navigateFn: () => void) => {
        if (feedbackSubmitted || violatedRules.length === 0) {
            navigateFn()
            return
        }
        setIsSubmitting(true)
        try {
            // Only send feedback for violated rules
            const items = violatedRules.map((rule: any) => ({
                rule_id:  rule.rule_id,
                feedback: agreedRuleIds.has(rule.id) ? 1 : -1,
            }))

            const profile = auditResult?.meta?.profile || auditResult?.profile || 'universal'
            console.log('[VioletRules] Submitting feedback:', { profile, items })

            const res = await fetch('http://localhost:8000/audit/feedback/batch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ profile, items }),
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error('[VioletRules] Feedback error:', err)
            } else {
                setFeedbackSubmitted(true)
            }
        } catch (error) {
            console.error('[VioletRules] Failed to submit feedback:', error)
        } finally {
            setIsSubmitting(false)
            navigateFn()
        }
    }

    const handleExport = async () => {
        try {
            const response = await fetch('http://localhost:8000/audit/export', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(auditResult),
            })
            const blob = await response.blob()
            const url  = window.URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href     = url
            a.download = `audit_report_${Date.now()}.md`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
        } catch (error) {
            console.error('Export failed:', error)
            alert('Export failed. Please ensure the server is running.')
        }
    }

    const agreedCount = violatedRules.filter((r: any) => agreedRuleIds.has(r.id)).length

    return (
        <div style={{ paddingBottom: '100px' }}>
            <h1 className="page-heading">
                {step === 'violet-rules' ? 'Audited Rules' : 'Violated Rules'}
            </h1>

            {/* Profile badge */}
            {auditResult?.meta?.profile && (
                <div style={{
                    display: 'inline-block',
                    background: 'rgba(124,77,255,0.15)',
                    border: '1px solid rgba(124,77,255,0.4)',
                    borderRadius: '20px', padding: '4px 14px',
                    fontSize: '0.8rem', fontWeight: 600,
                    color: 'var(--purple-primary, #7C4DFF)', marginBottom: '1rem',
                }}>
                    Profile: {auditResult.meta.profile.toUpperCase()}
                </div>
            )}

            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
                marginBottom: 'var(--space-6)', lineHeight: 1.6 }}>
                {step === 'violet-rules'
                    ? <>All evaluated rules shown below. <strong>Violated rules</strong> can be checked/unchecked to give feedback. <strong>Passed rules</strong> are shown read-only.</>
                    : <>Only violated rules shown. Check rules you agree with, uncheck to dismiss.</>
                }
            </p>

            {/* Summary counts */}
            {step === 'violet-rules' && hasRunAudit && (
                <div style={{ display: 'flex', gap: '12px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{
                        background: 'rgba(226,75,74,0.12)', border: '1px solid rgba(226,75,74,0.3)',
                        borderRadius: '8px', padding: '6px 16px',
                        fontSize: '0.82rem', fontWeight: 600, color: '#E24B4A',
                    }}>
                        ❌ {violatedRules.length} violated
                    </div>
                    <div style={{
                        background: 'rgba(99,153,34,0.12)', border: '1px solid rgba(99,153,34,0.3)',
                        borderRadius: '8px', padding: '6px 16px',
                        fontSize: '0.82rem', fontWeight: 600, color: '#639922',
                    }}>
                        ✅ {passedRules.length} passed
                    </div>
                </div>
            )}

            {/* Rule Cards */}
            {displayRules.length > 0 ? (
                displayRules.map((rule: any) => {
                    const isViolated = rule.violated === true
                    const isAgreed   = agreedRuleIds.has(rule.id)
                    const isViewOnly = !isViolated

                    return (
                        <div
                            key={rule.id}
                            className={`rule-card ${isViewOnly ? 'rule-card--passed' : ''}`}
                            onClick={() => toggleRule(rule.id, isViolated)}
                            style={{
                                cursor: isViolated ? 'pointer' : 'default',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 'var(--space-4)',
                                border: isViolated && isAgreed
                                    ? '2px solid var(--purple-primary, #7C4DFF)'
                                    : '2px solid transparent',
                                opacity: isViewOnly ? 0.75 : 1,
                                transition: 'border-color 0.2s ease',
                            }}
                        >
                            {/* Checkbox — only for violated rules */}
                            <div style={{
                                minWidth: '24px', height: '24px', borderRadius: '6px',
                                border: isViewOnly
                                    ? '2px solid var(--color-border-tertiary, #444)'
                                    : isAgreed ? 'none' : '2px solid var(--text-muted, #888)',
                                background: isViewOnly
                                    ? 'transparent'
                                    : isAgreed ? 'var(--purple-primary, #7C4DFF)' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                marginTop: '2px', flexShrink: 0,
                            }}>
                                {isViewOnly ? (
                                    /* Passed — show lock icon to indicate read-only */
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                         stroke="var(--text-muted, #888)" strokeWidth="2.5"
                                         strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                ) : isAgreed ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                         stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : null}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1 }}>
                                <div className="rule-card__title">
                                    {isViolated ? '❌ ' : '✅ '}
                                    {rule.title}
                                    <span style={{
                                        marginLeft: '8px', fontSize: '0.7rem',
                                        background: 'rgba(124,77,255,0.15)',
                                        borderRadius: '4px', padding: '1px 6px',
                                        color: 'var(--purple-primary, #7C4DFF)', fontWeight: 600,
                                    }}>
                                        {rule.rule_id}
                                    </span>
                                    {isViewOnly && (
                                        <span style={{
                                            marginLeft: '6px', fontSize: '0.65rem',
                                            background: 'rgba(99,153,34,0.15)',
                                            borderRadius: '4px', padding: '1px 6px',
                                            color: '#639922', fontWeight: 600,
                                        }}>
                                            passed
                                        </span>
                                    )}
                                </div>
                                <div className="rule-card__description">{rule.description}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Source: {rule.source}
                                    {isViewOnly && ' · read-only — no feedback needed for passed rules'}
                                </div>
                            </div>
                        </div>
                    )
                })
            ) : hasRunAudit ? (
                <div className="card card-green text-center" style={{ padding: 'var(--space-12)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 'var(--space-4)' }}>✅</div>
                    <h3 className="feature-card__title">No Violations Found</h3>
                    <p className="feature-card__desc">All rules passed. Great job!</p>
                </div>
            ) : (
                <div className="card text-center" style={{ padding: 'var(--space-12)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>No audit has been run yet.</p>
                </div>
            )}

            {/* Score + Export (step 2) */}
            {step === 'violet-accuracy' && (
                <div className="accuracy-section">
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <span className="accuracy-section__label">UI Score</span>
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

            {/* Sticky feedback bar — only counts violated rules */}
            {violatedRules.length > 0 && (
                <div style={{
                    position: 'fixed', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(135deg, rgba(20,20,30,0.98), rgba(30,25,50,0.98))',
                    backdropFilter: 'blur(12px)',
                    borderTop: '1px solid rgba(124,77,255,0.3)',
                    padding: '16px 32px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                    zIndex: 1000, boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
                }}>
                    <div style={{
                        background: 'rgba(124,77,255,0.15)', borderRadius: '8px',
                        padding: '6px 14px', fontWeight: 700, fontSize: '14px',
                        color: 'var(--purple-primary, #7C4DFF)',
                    }}>
                        {agreedCount} / {violatedRules.length}
                    </div>
                    <span style={{ color: 'var(--text-muted, #aaa)', fontSize: '14px' }}>
                        violations agreed
                    </span>
                    {feedbackSubmitted && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            color: '#4CAF50', fontWeight: 600, fontSize: '13px', marginLeft: '8px',
                        }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
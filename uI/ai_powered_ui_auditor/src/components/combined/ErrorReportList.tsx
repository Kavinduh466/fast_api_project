import type { ErrorReportItem } from '../../types/combined.types'

const SEVERITY_CONFIG = {
  high: { label: 'High', color: 'var(--red-high)', bg: 'rgba(239,83,80,0.08)', border: 'rgba(239,83,80,0.2)' },
  medium: { label: 'Medium', color: 'var(--orange-medium)', bg: 'rgba(255,167,38,0.08)', border: 'rgba(255,167,38,0.2)' },
  low: { label: 'Low', color: 'var(--blue-info)', bg: 'rgba(66,165,245,0.08)', border: 'rgba(66,165,245,0.2)' },
}

const SOURCE_LABEL: Record<'comp1' | 'comp2', string> = {
  comp1: 'Violation Rule',
  comp2: 'Element Score',
}

interface Props {
  items: ErrorReportItem[]
  llmAnalysis?: string
}

export default function ErrorReportList({ items, llmAnalysis }: Props) {
  const high = items.filter(i => i.severity === 'high')
  const medium = items.filter(i => i.severity === 'medium')
  const low = items.filter(i => i.severity === 'low')

  return (
    <div className="ca-error-report">
      <div className="ca-section-label" style={{ marginBottom: 'var(--space-4)' }}>Error & Suggestion Report</div>

      {/* All clear banner */}
      {items.length === 0 && (
        <div className="ca-synthesis-banner" style={{ marginBottom: 'var(--space-4)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          All checks passed — no rule violations and all elements score above threshold.
        </div>
      )}

      {/* Summary counts */}
      <div className="ca-report-summary">
        <div className="ca-report-stat" style={{ color: SEVERITY_CONFIG.high.color }}>
          <span className="ca-report-stat__num">{high.length}</span>
          <span className="ca-report-stat__label">High</span>
        </div>
        <div className="ca-report-divider" />
        <div className="ca-report-stat" style={{ color: SEVERITY_CONFIG.medium.color }}>
          <span className="ca-report-stat__num">{medium.length}</span>
          <span className="ca-report-stat__label">Medium</span>
        </div>
        <div className="ca-report-divider" />
        <div className="ca-report-stat" style={{ color: 'var(--blue-info)' }}>
          <span className="ca-report-stat__num">{low.length}</span>
          <span className="ca-report-stat__label">Low</span>
        </div>
        <div className="ca-report-divider" />
        <div className="ca-report-stat">
          <span className="ca-report-stat__num">{items.length}</span>
          <span className="ca-report-stat__label">Total</span>
        </div>
      </div>

      {/* Error items */}
      <div className="ca-error-list">
        {items.map(item => {
          const sev = SEVERITY_CONFIG[item.severity]
          return (
            <div
              key={item.id}
              className="ca-error-item"
              style={{ borderLeft: `3px solid ${sev.color}` }}
            >
              <div className="ca-error-item__header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span className="ca-badge" style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}>
                    {sev.label}
                  </span>
                  <span className="ca-badge ca-badge--source">{SOURCE_LABEL[item.source]}</span>
                  {item.elementType && (
                    <span className="ca-badge ca-badge--element">{item.elementType}</span>
                  )}
                </div>
                <span className="ca-error-item__title">{item.title}</span>
              </div>
              <p className="ca-error-item__desc">{item.description}</p>
              <div className="ca-suggestion-box">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                <span>{item.suggestion}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* LLM free-form analysis if present */}
      {llmAnalysis && (
        <div className="ca-llm-analysis">
          <div className="ca-section-label" style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--font-xs)' }}>LLM Analysis</div>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{llmAnalysis}</p>
        </div>
      )}
    </div>
  )
}

import { useState, useTransition } from 'react'
import type { FeedbackGenerateResult, ResultPhase, AnalysisOption } from '../../types/combined.types'

const BASE_URL = 'http://localhost:8000'

const PHASE_LABELS: Record<ResultPhase, string> = {
  phase1: 'Annotated UI',
  phase2: 'Aesthetic Analysis',
  phase3: 'Combined Synthesis',
}

function phaseHelpLine(phase: ResultPhase, selectedOption: AnalysisOption): string | null {
  if (phase === 'phase1') {
    if (selectedOption === 'all') {
      return 'Rule violations and low-similarity elements (up to 5 + 5) with ERR/FIX callouts.'
    }
    if (selectedOption === 'rules') {
      return 'Rule violations with ERR/FIX callouts.'
    }
    return 'Low-similarity elements with ERR/FIX callouts.'
  }
  if (phase === 'phase2') {
    return 'Low-similarity elements (expert pattern scores) with ERR/FIX callouts.'
  }
  if (phase === 'phase3') {
    return 'Technical callouts plus aesthetic callouts on one image; four-word priority is in the banner above.'
  }
  return null
}

function getAvailablePhases(result: FeedbackGenerateResult): ResultPhase[] {
  const phases: ResultPhase[] = []
  // Phase 1 (annotated UI with bounding boxes) is always shown when available
  if (result.images.phase1_technical) phases.push('phase1')
  if (result.images.phase2_aesthetic) phases.push('phase2')
  if (result.images.phase3_synthesis) phases.push('phase3')
  return phases
}

function getPhaseUrl(result: FeedbackGenerateResult, phase: ResultPhase): string {
  const map: Record<ResultPhase, string | undefined> = {
    phase1: result.images.phase1_technical,
    phase2: result.images.phase2_aesthetic,
    phase3: result.images.phase3_synthesis,
  }
  return `${BASE_URL}${map[phase] || ''}`
}

interface Props {
  feedbackResult: FeedbackGenerateResult
  selectedOption: AnalysisOption
}

export default function AnnotatedResultView({ feedbackResult, selectedOption }: Props) {
  const availablePhases = getAvailablePhases(feedbackResult)
  const [activePhase, setActivePhase] = useState<ResultPhase>(availablePhases[0] || 'phase1')
  const [isPending, startTransition] = useTransition()
  const activePhaseHelp = phaseHelpLine(activePhase, selectedOption)

  const showTabs = availablePhases.length > 1

  // Description per option so users know what the annotated image represents
  const optionDesc: Record<AnalysisOption, string> = {
    rules: 'Elements violating UI/UX rules are highlighted with red bounding boxes and suggested fixes.',
    elements: 'Elements scoring below threshold are highlighted with similarity mismatch annotations.',
    all: 'Both rule violations and low-scoring elements are highlighted together.',
  }

  return (
    <div className="ca-annotated-view">
      {/* Synthesis message — only available in 'all' mode */}
      {feedbackResult.synthesis_message && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div className="ca-section-label">LLM Priority Finding</div>
          <div className="ca-synthesis-banner">
            <span className="ca-synthesis-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </span>
            {feedbackResult.synthesis_message}
          </div>
        </div>
      )}

      {/* Option context */}
      <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        {optionDesc[selectedOption]}
      </p>

      {/* Phase tabs — only shown if multiple phases available */}
      {showTabs && (
        <div className="ca-phase-tabs">
          {availablePhases.map(phase => (
            <button
              key={phase}
              className={`ca-phase-tab${activePhase === phase ? ' active' : ''}`}
              onClick={() => startTransition(() => setActivePhase(phase))}
              disabled={isPending}
            >
              {PHASE_LABELS[phase]}
            </button>
          ))}
        </div>
      )}

      {/* Single label when no tabs */}
      {!showTabs && availablePhases.length === 1 && (
        <div className="ca-section-label" style={{ marginBottom: 'var(--space-3)' }}>
          {PHASE_LABELS[availablePhases[0]]}
        </div>
      )}

      {activePhaseHelp && (
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          {activePhaseHelp}
        </p>
      )}

      {/* Annotated image */}
      <div className={`ca-annotated-img-wrap${isPending ? ' ca-img-pending' : ''}`}>
        {availablePhases.length > 0 ? (
          <img
            key={activePhase}
            src={getPhaseUrl(feedbackResult, activePhase)}
            alt={PHASE_LABELS[activePhase]}
            className="ca-annotated-img"
          />
        ) : (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
            No annotated image available for this analysis type.
          </div>
        )}
      </div>
    </div>
  )
}

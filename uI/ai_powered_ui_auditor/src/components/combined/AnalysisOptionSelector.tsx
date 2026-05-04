import { useTransition } from 'react'
import type { AnalysisOption, AnalysisOptionConfig } from '../../types/combined.types'

const OPTIONS: AnalysisOptionConfig[] = [
  {
    id: 'rules',
    title: 'UI + Violation Rules',
    desc: 'Analyse UI against design violation rules and best practices',
    badge: 'Comp 1',
  },
  {
    id: 'elements',
    title: 'UI + Element Scores',
    desc: 'Detect and score individual UI elements against expert patterns',
    badge: 'Comp 2',
  },
  {
    id: 'all',
    title: 'UI + Rules + Element Scores',
    desc: 'Full analysis — violation rules, element scoring, and LLM enhancement',
    badge: 'Comp 1 + 2',
  },
]

interface Props {
  selected: AnalysisOption
  onChange: (option: AnalysisOption) => void
}

export default function AnalysisOptionSelector({ selected, onChange }: Props) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="ca-option-selector" style={{ opacity: isPending ? 0.7 : 1, transition: 'opacity 150ms' }}>
      {OPTIONS.map(opt => (
        <div
          key={opt.id}
          className={`radio-option${selected === opt.id ? ' selected' : ''}`}
          onClick={() => startTransition(() => onChange(opt.id))}
        >
          <div className="radio-option__dot" />
          <div className="radio-option__info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <span className="radio-option__title">{opt.title}</span>
              <span className="ca-badge ca-badge--source">{opt.badge}</span>
            </div>
            <div className="radio-option__desc">{opt.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

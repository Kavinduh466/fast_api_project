import { useEffect, useRef, useState } from 'react'
import { RULE_CATEGORIES } from '../../constants/ruleCategories'

interface Props {
  value: string
  onChange: (profile: string) => void
}

export default function RuleCategoryDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = RULE_CATEGORIES.find(c => c.value === value) || RULE_CATEGORIES[0]

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div className="rule-category" ref={ref}>
      <div className="rule-category__header">
        <span className="ca-section-label">Rule Category</span>
        <span className="ca-badge ca-badge--source">Applies to Violation Rules</span>
      </div>
      <p className="rule-category__hint">
        Violation rules are evaluated against this design profile — same as the Rule Based Analyser.
      </p>

      <button
        type="button"
        className={`rule-category__trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="rule-category__selected">
          <span className="rule-category__icon" aria-hidden>{selected.icon}</span>
          <span className="rule-category__text">
            <span className="rule-category__label">{selected.label}</span>
            <span className="rule-category__desc">{selected.description}</span>
          </span>
        </span>
        <svg
          className="rule-category__chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="rule-category__menu" role="listbox">
          {RULE_CATEGORIES.map(cat => {
            const isSelected = cat.value === value
            return (
              <button
                type="button"
                key={cat.value}
                role="option"
                aria-selected={isSelected}
                className={`rule-category__item${isSelected ? ' is-selected' : ''}`}
                onClick={() => {
                  onChange(cat.value)
                  setOpen(false)
                }}
              >
                <span className="rule-category__icon" aria-hidden>{cat.icon}</span>
                <span className="rule-category__text">
                  <span className="rule-category__label">{cat.label}</span>
                  <span className="rule-category__desc">{cat.description}</span>
                </span>
                {isSelected && (
                  <svg
                    className="rule-category__check"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

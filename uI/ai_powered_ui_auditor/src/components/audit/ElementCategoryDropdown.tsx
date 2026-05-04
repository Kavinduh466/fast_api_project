import { useEffect, useRef, useState } from 'react'
import {
  ELEMENT_AUDIT_CATEGORIES,
  type ElementAuditCategory,
} from '../../constants/elementAuditCategories'

interface Props {
  value: string
  onChange: (category: string) => void
  /** Shown as the small badge on the right of the header. */
  badge?: string
  /** Hint paragraph under the header. */
  hint?: string
}

export default function ElementCategoryDropdown({
  value,
  onChange,
  badge = 'Scored against expert library',
  hint = 'The CLIP + FAISS similarity match is restricted to expert UIs from this category. Pick "Universal" to compare against the full library.',
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected: ElementAuditCategory =
    ELEMENT_AUDIT_CATEGORIES.find(c => c.value === value) ||
    ELEMENT_AUDIT_CATEGORIES[0]

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
        <span className="ca-section-label">Expert-library category</span>
        <span className="ca-badge ca-badge--source">{badge}</span>
      </div>
      <p className="rule-category__hint">{hint}</p>

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
          {ELEMENT_AUDIT_CATEGORIES.map(cat => {
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

import { useState } from 'react'

interface Props {
  originalImageUrl: string | null
  enhancedImageUrl: string | null
  isLoading: boolean
  error: string | null
  onBack: () => void
}

export default function ComparisonView({ originalImageUrl, enhancedImageUrl, isLoading, error, onBack }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)

  if (error) {
    return (
      <div className="ca-error-banner">
        <p>{error}</p>
        <button className="btn btn-outline" style={{ marginTop: 'var(--space-4)' }} onClick={onBack}>
          Back to Results
        </button>
      </div>
    )
  }

  return (
    <div className="ca-comparison">
      <div className="ca-comparison__panel">
        <div className="ca-comparison__label ca-comparison__label--original">Original Input</div>
        <div className="ca-comparison__img-wrap">
          {originalImageUrl ? (
            <img src={originalImageUrl} alt="Original UI" className="ca-comparison__img" />
          ) : (
            <div className="ca-comparison__placeholder">No image</div>
          )}
        </div>
      </div>

      <div className="ca-comparison__divider">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      <div className="ca-comparison__panel">
        <div className="ca-comparison__label ca-comparison__label--enhanced">Enhanced Output</div>
        <div className="ca-comparison__img-wrap ca-comparison__img-wrap--enhanced">
          {isLoading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-2)' }}>
                Ai is generating enhanced UI…
              </p>
            </div>
          ) : enhancedImageUrl && !imgError ? (
            <>
              {!imgLoaded && (
                <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                  <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                </div>
              )}
              <img
                src={enhancedImageUrl}
                alt="Enhanced UI"
                className="ca-comparison__img"
                style={{ display: imgLoaded ? 'block' : 'none' }}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            </>
          ) : imgError ? (
            <div className="ca-comparison__placeholder">Image generation failed.</div>
          ) : (
            <div className="ca-comparison__placeholder">No enhanced image</div>
          )}
        </div>
      </div>
    </div>
  )
}

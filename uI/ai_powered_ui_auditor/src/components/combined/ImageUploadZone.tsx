import { useRef, useState, useCallback } from 'react'

interface Props {
  uploadedFile: File | null
  previewUrl: string | null
  uploadProgress: number
  onFileSelect: (file: File) => void
}

export default function ImageUploadZone({ uploadedFile, previewUrl, uploadProgress, onFileSelect }: Props) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) onFileSelect(f)
  }, [onFileSelect])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onFileSelect(f)
  }, [onFileSelect])

  const isReady = uploadedFile && uploadProgress >= 100

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <label className="ca-label">Upload UI Screenshot</label>
      <div
        className={`upload-zone${dragOver ? ' drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="upload-zone__icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="upload-zone__text">Drag & Drop or <span>Choose file</span> to upload</p>
        <p className="upload-zone__formats">png, jpg, jpeg</p>
        <input ref={inputRef} type="file" accept=".png,.jpeg,.jpg" style={{ display: 'none' }} onChange={handleChange} />
      </div>

      {uploadedFile && (
        <div className="file-progress" style={{ marginTop: 'var(--space-4)' }}>
          <div className="file-progress__icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect width="24" height="24" rx="4" fill="#7C4DFF" fillOpacity="0.1" />
              <path d="M7 7h10v10H7z" fill="#7C4DFF" fillOpacity="0.3" />
            </svg>
          </div>
          <div className="file-progress__info">
            <div className="file-progress__name">{uploadedFile.name}</div>
            <div className="file-progress__meta">
              {(uploadedFile.size / 1024 / 1024).toFixed(1)}MB · {uploadProgress >= 100 ? 'Ready' : 'Processing…'}
            </div>
            <div className="file-progress__bar">
              <div className="file-progress__bar-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
          <div className="file-progress__percent">{Math.round(uploadProgress)}%</div>
        </div>
      )}

      {isReady && previewUrl && (
        <div className="ca-preview-box" style={{ marginTop: 'var(--space-5)' }}>
          <p className="ca-label" style={{ marginBottom: 'var(--space-2)' }}>Preview</p>
          <div className="ca-preview-img-wrap">
            <img src={previewUrl} alt="Uploaded UI Preview" className="ca-preview-img" />
          </div>
        </div>
      )}
    </div>
  )
}

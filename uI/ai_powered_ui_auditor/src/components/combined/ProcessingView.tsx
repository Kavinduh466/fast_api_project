interface Props {
  status: string
}

export default function ProcessingView({ status }: Props) {
  return (
    <div className="spinner-container">
      <div className="spinner" />
      <div className="spinner-text">Analysing UI</div>
      {status && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', marginTop: 'var(--space-3)', textAlign: 'center', maxWidth: 280 }}>
          {status}
        </p>
      )}
    </div>
  )
}

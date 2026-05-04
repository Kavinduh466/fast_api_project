import { useState } from 'react'
import { useCombinedAnalysis } from '../hooks/useCombinedAnalysis'
import AnalysisOptionSelector from '../components/combined/AnalysisOptionSelector'
import ImageUploadZone from '../components/combined/ImageUploadZone'
import ProcessingView from '../components/combined/ProcessingView'
import AnnotatedResultView from '../components/combined/AnnotatedResultView'
import ErrorReportList from '../components/combined/ErrorReportList'
import ComparisonView from '../components/combined/ComparisonView'
import RuleCategoryDropdown from '../components/combined/RuleCategoryDropdown'
import { downloadCombinedAnalysisPdf } from '../utils/combinedAnalysisPdf'

interface CombinedAnalysisProps {
  onBack: () => void
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="back-button-circle" title="Back">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>
  )
}

export default function CombinedAnalysis({ onBack }: CombinedAnalysisProps) {
  const [exportingPdf, setExportingPdf] = useState(false)

  const {
    selectedOption,
    pageStep,
    uploadedFile,
    previewUrl,
    uploadProgress,
    processingStatus,
    comp1Result,
    comp2Result,
    feedbackResult,
    enhancedImageUrl,
    previewLoading,
    error,
    errorReport,
    isPending,
    setSelectedOption,
    ruleProfile,
    setRuleProfile,
    setPageStep,
    handleFileSelect,
    handleStartAnalysis,
    handlePreview,
    handleReset,
  } = useCombinedAnalysis()

  const handleDownloadPdf = async () => {
    if (!feedbackResult) return
    setExportingPdf(true)
    try {
      await downloadCombinedAnalysisPdf({
        selectedOption,
        ruleProfile,
        feedbackResult,
        errorReport,
        comp2Result,
      })
    } catch (e) {
      console.error(e)
      alert(`Could not build PDF: ${String(e)}`)
    } finally {
      setExportingPdf(false)
    }
  }

  const isUploadReady = !!uploadedFile && uploadProgress >= 100

  // ── Processing ──────────────────────────────────────────────
  if (pageStep === 'processing') {
    return (
      <div className="page-container page-enter">
        <ProcessingView status={processingStatus} />
      </div>
    )
  }

  // ── Comparison ──────────────────────────────────────────────
  if (pageStep === 'comparison') {
    return (
      <div className="page-container page-enter">
        <div className="ca-page-header">
          <BackButton onClick={() => setPageStep('results')} />
          <h1 className="page-heading" style={{ margin: 0 }}>Input vs Enhanced</h1>
        </div>

        <ComparisonView
          originalImageUrl={previewUrl}
          enhancedImageUrl={enhancedImageUrl}
          isLoading={previewLoading}
          error={error}
          onBack={() => setPageStep('results')}
        />

        <button className="btn btn-outline" style={{ width: '100%', marginTop: 'var(--space-6)' }} onClick={() => setPageStep('results')}>
          Back to Analysis Results
        </button>
      </div>
    )
  }

  // ── Results ─────────────────────────────────────────────────
  if (pageStep === 'results' && feedbackResult) {
    return (
      <div className="page-container page-enter">
        <div className="ca-page-header">
          <BackButton onClick={onBack} />
          <h1 className="page-heading" style={{ margin: 0 }}>Analysis Output</h1>
        </div>

        {error && <div className="ca-error-banner" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

        <AnnotatedResultView feedbackResult={feedbackResult} selectedOption={selectedOption} />

        <ErrorReportList items={errorReport} llmAnalysis={comp1Result?.llm_analysis} />

        <div className="ca-footer-actions" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary btn-primary-lg shadow-glow"
            style={{ flex: 1, minWidth: 200, opacity: isPending ? 0.7 : 1 }}
            onClick={handlePreview}
            disabled={isPending || previewLoading || !feedbackResult.generator_prompt}
            title={
              !feedbackResult.generator_prompt
                ? 'No redesign prompt was generated — try running the analysis again.'
                : 'Generate an enhanced redesign from this UI'
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 'var(--space-2)' }}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            Preview Enhanced UI
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ flex: 1, minWidth: 200 }}
            onClick={handleDownloadPdf}
            disabled={exportingPdf}
            title="Download a PDF with issues, fixes, element numbers, and annotated screenshots"
          >
            {exportingPdf ? 'Building PDF…' : 'Download PDF Report'}
          </button>
          <button className="btn btn-outline" style={{ flex: 1, minWidth: 200 }} onClick={handleReset}>
            Analyse Another UI
          </button>
        </div>
      </div>
    )
  }

  // ── Selection (default) ─────────────────────────────────────
  return (
    <div className="page-container page-enter">
      <div className="ca-page-header">
        <BackButton onClick={onBack} />
        <div>
          <h1 className="page-heading" style={{ margin: 0 }}>Combined Analysis</h1>
          <p className="page-subheading" style={{ margin: '0.25rem 0 0' }}>
            Upload your UI and choose what to analyse
          </p>
        </div>
      </div>

      {error && <div className="ca-error-banner" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <AnalysisOptionSelector selected={selectedOption} onChange={setSelectedOption} />

      {(selectedOption === 'rules' || selectedOption === 'all') && (
        <RuleCategoryDropdown value={ruleProfile} onChange={setRuleProfile} />
      )}

      <ImageUploadZone
        uploadedFile={uploadedFile}
        previewUrl={previewUrl}
        uploadProgress={uploadProgress}
        onFileSelect={handleFileSelect}
      />

      <div className="ca-footer-actions" style={{ marginTop: 'var(--space-6)' }}>
        <button
          className="btn btn-primary btn-primary-lg shadow-glow"
          style={{ width: '100%', maxWidth: 400, opacity: isUploadReady ? 1 : 0.5, cursor: isUploadReady ? 'pointer' : 'not-allowed' }}
          onClick={handleStartAnalysis}
          disabled={!isUploadReady || isPending}
        >
          Start Analysis
        </button>
      </div>
    </div>
  )
}

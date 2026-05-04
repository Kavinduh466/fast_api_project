import { useState, useTransition, useCallback, useRef } from 'react'
import type {
  AnalysisOption,
  PageStep,
  Comp1Result,
  Comp1Violation,
  Comp2Result,
  FeedbackGenerateResult,
  ErrorReportItem,
} from '../types/combined.types'


const BASE_URL = 'http://localhost:8000'

function buildCombinedAuditJson(comp1: Comp1Result | null, comp2: Comp2Result | null) {
  const combined: { elements: any[] } = { elements: [] }

  // Use comp1.elements (detected UI components with bboxes and FAIL/PASS status)
  // NOT comp1.violations (text-based rules without bboxes)
  if (comp1?.elements) {
    combined.elements.push(
      ...comp1.elements.map((el: any) => ({
        ...el,
        source: 'comp1_ai_audit',
      }))
    )
  }

  // Map comp2 components — mark < 70% similarity as FAIL so backend draws boxes
  if (comp2?.components) {
    combined.elements.push(
      ...comp2.components.map(c => ({
        ...c,
        source: 'comp2_element_audit',
        status: c.similarity_score < 70 ? 'FAIL' : 'PASS',
        issues:
          c.similarity_score < 70
            ? [{ desc: `Score ${c.similarity_score.toFixed(0)}% — ${c.class}` }]
            : [],
      }))
    )
  }

  return combined
}

function humanizeRuleId(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Backend sends `rule_id` / `rule_name`; older payloads used `rule` / `title`. */
function violationRuleRef(v: Comp1Violation): string {
  const r = v.rule?.trim()
  if (r && r !== 'undefined') return r
  const id = v.rule_id?.trim()
  if (id && id !== 'undefined') return id
  const n = v.rule_name?.trim()
  if (n && n !== 'undefined') return n
  return 'design-rule'
}

function violationIssueTitle(v: Comp1Violation): string {
  const t = v.title?.trim()
  if (t && t !== 'undefined') return t
  const n = v.rule_name?.trim()
  if (n && n !== 'undefined') return n
  const id = v.rule_id?.trim()
  if (id && id !== 'undefined') return humanizeRuleId(id)
  return 'Rule violation'
}

function elementLabelForViolation(comp1: Comp1Result | null, v: Comp1Violation): string {
  const t = v.element_info?.type?.trim()
  if (t && t !== 'undefined') return t
  const eid = v.element_id
  if (eid != null && comp1?.elements?.length) {
    const el = comp1.elements.find(e => e.id === eid)
    if (el?.type?.trim()) return el.type.trim()
  }
  return 'UI control'
}

function buildErrorReport(
  comp1: Comp1Result | null,
  comp2: Comp2Result | null,
  option: AnalysisOption,
): ErrorReportItem[] {
  const items: ErrorReportItem[] = []

  // Only include rule violations for 'rules' or 'all'
  if ((option === 'rules' || option === 'all') && comp1?.violations) {
    const violated = comp1.violations.filter(v => v.violated)
    violated.forEach((v, i) => {
      const ruleRef = violationRuleRef(v)
      const issueTitle = violationIssueTitle(v)
      const elLabel = elementLabelForViolation(comp1, v)
      const desc = (v.description || '').replace(/\s+/g, ' ').trim()
      items.push({
        id: `comp1-${i}`,
        severity: 'high',
        title: issueTitle,
        description: desc,
        elementType: elLabel,
        source: 'comp1',
        suggestion:
          `Adjust the ${elLabel} to satisfy “${issueTitle}” (${ruleRef}). ${desc}`.trim(),
        violationNumber: i + 1,
        ruleReference: ruleRef,
      })
    })
  }

  // Only include element scores for 'elements' or 'all'
  if ((option === 'elements' || option === 'all') && comp2?.components) {
    comp2.components.forEach((c, idx) => {
      if (c.similarity_score >= 70) return
      const sev = c.similarity_score < 30 ? 'high' : c.similarity_score < 50 ? 'medium' : 'low'
      const elementNumber = c.id ?? idx + 1
      items.push({
        id: `comp2-${elementNumber}-${idx}`,
        severity: sev,
        title: `${sev === 'low' ? 'Below Target' : 'Low Similarity'}: ${c.class}`,
        description: `"${c.class}" scores ${c.similarity_score.toFixed(1)}% similarity against expert patterns (matched: ${c.matched_expert}).`,
        elementType: c.class,
        source: 'comp2',
        suggestion: `Improve the "${c.class}" to better match the "${c.matched_expert}" pattern. Target ≥70% similarity.`,
        elementNumber,
      })
    })
  }

  return items
}

export function useCombinedAnalysis() {
  const [selectedOption, setSelectedOption] = useState<AnalysisOption>('all')
  /** Passed to /audit/smart as profile_form when rules are included */
  const [ruleProfile, setRuleProfile] = useState('universal')
  const [pageStep, setPageStep] = useState<PageStep>('selection')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingStatus, setProcessingStatus] = useState('')
  const [comp1Result, setComp1Result] = useState<Comp1Result | null>(null)
  const [comp2Result, setComp2Result] = useState<Comp2Result | null>(null)
  const [feedbackResult, setFeedbackResult] = useState<FeedbackGenerateResult | null>(null)
  const [enhancedImageUrl, setEnhancedImageUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorReport, setErrorReport] = useState<ErrorReportItem[]>([])

  const [isPending, startTransition] = useTransition()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleFileSelect = useCallback((file: File) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const url = URL.createObjectURL(file)
    setUploadedFile(file)
    setPreviewUrl(url)
    setUploadProgress(0)
    setError(null)

    let progress = 0
    intervalRef.current = setInterval(() => {
      progress += Math.random() * 15 + 5
      if (progress >= 100) {
        progress = 100
        clearInterval(intervalRef.current!)
        intervalRef.current = null
      }
      setUploadProgress(Math.min(progress, 100))
    }, 300)
  }, [])

  const handleStartAnalysis = useCallback(async () => {
    if (!uploadedFile) {
      setError('Please upload a UI screenshot first.')
      return
    }

    setPageStep('processing')
    setError(null)

    try {
      let c1: Comp1Result | null = null
      let c2: Comp2Result | null = null

      if (selectedOption === 'rules' || selectedOption === 'all') {
        setProcessingStatus('Running AI Audit — checking violation rules…')
        const fd = new FormData()
        fd.append('file', uploadedFile, uploadedFile.name)
        const profile = (ruleProfile || 'universal').trim().toLowerCase()
        fd.append('profile_form', profile)
        const res = await fetch(`${BASE_URL}/audit/smart`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error('AI Audit request failed.')
        c1 = await res.json()
        setComp1Result(c1)
      }

      if (selectedOption === 'elements' || selectedOption === 'all') {
        setProcessingStatus('Running Element Audit — scoring UI elements…')
        const fd = new FormData()
        fd.append('file', uploadedFile, uploadedFile.name)
        const res = await fetch(`${BASE_URL}/audit`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error('Element Audit request failed.')
        c2 = await res.json()
        setComp2Result(c2)
      }

      setProcessingStatus('Generating LLM analysis and annotated UI…')
      const enhanceFd = new FormData()
      enhanceFd.append('ui_image', uploadedFile, uploadedFile.name)
      enhanceFd.append('analysis_type', selectedOption)

      const combined = buildCombinedAuditJson(c1, c2)
      if (combined.elements.length > 0) {
        const blob = new Blob([JSON.stringify(combined)], { type: 'application/json' })
        enhanceFd.append('audit_json', blob, 'audit_data.json')
      }

      const enhanceRes = await fetch(`${BASE_URL}/feedback/generate`, {
        method: 'POST',
        body: enhanceFd,
      })
      if (!enhanceRes.ok) {
        const errData = await enhanceRes.json()
        throw new Error(errData.detail || errData.error || 'Feedback generation failed.')
      }

      const feedbackData: FeedbackGenerateResult = await enhanceRes.json()

      const report = buildErrorReport(c1, c2, selectedOption)

      startTransition(() => {
        setFeedbackResult(feedbackData)
        setErrorReport(report)
        setPageStep('results')
      })
    } catch (err: any) {
      console.error('Combined analysis error:', err)
      setError(err.message || 'An unexpected error occurred.')
      startTransition(() => setPageStep('selection'))
    }
  }, [uploadedFile, selectedOption, ruleProfile])

  const handlePreview = useCallback(async () => {
    if (!uploadedFile || !feedbackResult?.generator_prompt) return
    setError(null)
    setPreviewLoading(true)
    startTransition(() => setPageStep('comparison'))

    try {
      const fd = new FormData()
      fd.append('ui_image', uploadedFile, uploadedFile.name)
      fd.append('prompt', feedbackResult.generator_prompt)

      const res = await fetch(`${BASE_URL}/uigen/gemini-image`, { method: 'POST', body: fd })
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.detail || errData.error || 'Gemini image generation failed.')
      }

      const data = await res.json()
      startTransition(() => setEnhancedImageUrl(`${BASE_URL}${data.image_url}`))
    } catch (err: any) {
      console.error('Gemini image gen error:', err)
      setError(err.message || 'Image generation failed.')
      startTransition(() => setPageStep('results'))
    } finally {
      setPreviewLoading(false)
    }
  }, [uploadedFile, feedbackResult])

  const handleReset = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    startTransition(() => {
      setUploadedFile(null)
      setPreviewUrl(null)
      setUploadProgress(0)
      setComp1Result(null)
      setComp2Result(null)
      setFeedbackResult(null)
      setEnhancedImageUrl(null)
      setPreviewLoading(false)
      setErrorReport([])
      setError(null)
      setRuleProfile('universal')
      setPageStep('selection')
    })
  }, [])

  return {
    selectedOption,
    ruleProfile,
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
    setRuleProfile,
    setPageStep,
    handleFileSelect,
    handleStartAnalysis,
    handlePreview,
    handleReset,
  }
}

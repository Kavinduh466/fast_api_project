export type AnalysisOption = 'rules' | 'elements' | 'all'
export type PageStep = 'selection' | 'processing' | 'results' | 'comparison'
export type ResultPhase = 'phase1' | 'phase2' | 'phase3'

/** Smart audit `/audit/smart` — metric + text rules use mixed field names. */
export interface Comp1Violation {
  id?: number
  /** Legacy / display slug */
  rule?: string
  /** From backend unified violations */
  rule_id?: string
  rule_name?: string
  title?: string
  description: string
  violated: boolean
  element_id?: number
  element_info?: {
    type: string
    bbox: number[]
    content?: string
  }
}

export interface Comp2Component {
  /** Detection order / badge id from element audit (when present). */
  id?: number
  class: string
  confidence: number
  bbox: number[]
  similarity_score: number
  matched_expert: string
}

export interface Comp1Element {
  id: number
  type: string
  cls_id: number
  bbox: number[]
  content: {
    text?: string
    contrast?: number | null
    bg_color?: number[] | null
  }
  issues: { desc: string }[]
  status: 'PASS' | 'FAIL'
}

export interface Comp1Result {
  meta?: { profile: string; timestamp: string }
  summary?: { score: number; violations: number }
  violations: Comp1Violation[]
  elements: Comp1Element[]
  llm_analysis?: string
}

export interface Comp2Result {
  report_id: string
  overall_score: number
  grade: string
  total_components: number
  components: Comp2Component[]
  report_image_url: string
}

export interface FeedbackGenerateResult {
  status: string
  images: {
    phase1_technical?: string
    phase2_aesthetic?: string
    phase3_synthesis?: string
  }
  synthesis_message: string
  generator_prompt: string
}

export interface UigenResult {
  status: string
  request_id: string
  images: {
    phase1: string
    phase2?: string
    phase3?: string
    phase6_improved: string
  }
  design_prompt: string
  suggestions: {
    phase1?: string[]
    phase2?: string[]
    phase3?: string[]
  }
}

export interface ErrorReportItem {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  elementType?: string
  source: 'comp1' | 'comp2'
  suggestion: string
  /** 1-based index among violated rules (Comp 1). */
  violationNumber?: number
  /** Element audit badge / row number for low-similarity items (Comp 2). */
  elementNumber?: number
  /** Design rule id / slug when available (Comp 1). */
  ruleReference?: string
}

export interface AnalysisOptionConfig {
  id: AnalysisOption
  title: string
  desc: string
  badge: string
}

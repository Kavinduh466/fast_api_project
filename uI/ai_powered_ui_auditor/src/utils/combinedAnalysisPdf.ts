import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { OverflowType } from 'jspdf-autotable'
import type {
  AnalysisOption,
  Comp2Result,
  ErrorReportItem,
  FeedbackGenerateResult,
} from '../types/combined.types'
import { RULE_CATEGORIES } from '../constants/ruleCategories'

const BASE_URL = 'http://localhost:8000'

/** PDF palette — slate / accent, distinct from default “gray grid” reports */
const PDF = {
  headerBg: [15, 23, 42] as [number, number, number],
  headerAccent: [56, 189, 248] as [number, number, number],
  ink: [15, 23, 42] as [number, number, number],
  slate700: [51, 65, 85] as [number, number, number],
  slate500: [100, 116, 139] as [number, number, number],
  slate400: [148, 163, 184] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
  surface: [248, 250, 252] as [number, number, number],
  card: [255, 255, 255] as [number, number, number],
  err: [185, 28, 28] as [number, number, number],
  errSoft: [254, 242, 242] as [number, number, number],
  warn: [180, 83, 9] as [number, number, number],
  warnSoft: [255, 251, 235] as [number, number, number],
  fix: [22, 101, 52] as [number, number, number],
  fixSoft: [240, 253, 244] as [number, number, number],
  high: [185, 28, 28] as [number, number, number],
  highBg: [254, 242, 242] as [number, number, number],
  med: [180, 83, 9] as [number, number, number],
  medBg: [255, 247, 237] as [number, number, number],
  low: [71, 85, 105] as [number, number, number],
  lowBg: [241, 245, 249] as [number, number, number],
}

const OPTION_TITLE: Record<AnalysisOption, string> = {
  rules: 'UI + Violation Rules',
  elements: 'UI + Element Scores',
  all: 'UI + Rules + Element Scores',
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onerror = () => reject(r.error)
      r.onload = () => resolve(r.result as string)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function ruleProfileLabel(profile: string): string {
  return RULE_CATEGORIES.find(c => c.value === profile)?.label || profile
}

/** Normalise PDF cell text (zero-width / odd spaces confuse jsPDF width + wrapping). */
function sanitizePdfText(s: string): string {
  return (s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * jspdf-autotable draws left-aligned cells with `doc.text(lines, x, y)` (no maxWidth).
 * `splitTextToSize` can still emit lines wider than the cell (quotes, URLs, rounding).
 * We split with padding, then shrink the max width until `getTextWidth` fits every line.
 */
function pdfTableCellOverflow(doc: InstanceType<typeof jsPDF>) {
  return (text: string | string[], textSpace: number): string | string[] => {
    const raw = Array.isArray(text) ? text.join('\n') : String(text)
    const fs = doc.getFontSize() || 10
    const target = Math.max(4, textSpace - 14)
    const opts = { fontSize: fs }
    let w = target
    let lines: string[] = []
    for (let i = 0; i < 10; i++) {
      lines = doc.splitTextToSize(raw, w, opts) as string[]
      const anyWide = lines.some(l => l && doc.getTextWidth(l) > w + 0.75)
      if (!anyWide) break
      w = Math.max(4, w * 0.9)
    }
    return lines.length ? lines : ['']
  }
}

/** Card-style issue list (no autotable) — reliable wrap + readable hierarchy. */
function renderIssueCardsPdf(
  doc: InstanceType<typeof jsPDF>,
  items: ErrorReportItem[],
  yStart: number,
  mx: number,
  contentW: number,
  pageH: number,
): number {
  const cardInset = 14
  const innerW = Math.max(120, contentW - cardInset * 2)
  const gap = 9
  const lhMeta = 13
  const lhBody = 11
  const lhLabel = 9
  let y = yStart

  const newPage = () => {
    doc.addPage()
    y = 48
  }

  doc.setCharSpace(0)

  items.forEach((item, idx) => {
    const isRule = item.source === 'comp1'
    const ref = isRule ? `V-${item.violationNumber ?? idx + 1}` : `E-${item.elementNumber ?? '—'}`
    const track = isRule ? 'Rule violation' : 'Element score'
    const ruleBit = item.ruleReference ? ` (${sanitizePdfText(item.ruleReference)})` : ''
    const issueText = sanitizePdfText(`${sanitizePdfText(item.title)}${ruleBit}`)
    const desc = sanitizePdfText(item.description)
    const fix = sanitizePdfText(item.suggestion)
    const sevLabel = item.severity.toUpperCase()

    let sevRgb: [number, number, number] = PDF.slate700
    if (item.severity === 'high') {
      sevRgb = PDF.high
    } else if (item.severity === 'medium') {
      sevRgb = PDF.med
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    const metaLines = doc.splitTextToSize(`#${idx + 1}  ·  ${ref}  ·  ${track}`, innerW, {
      fontSize: 11,
    }) as string[]

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const issueLines = doc.splitTextToSize(issueText, innerW, { fontSize: 9 }) as string[]
    const detailLines = doc.splitTextToSize(desc, innerW, { fontSize: 9 }) as string[]
    const fixLines = doc.splitTextToSize(fix, innerW, { fontSize: 9 }) as string[]

    const cardH =
      cardInset +
      metaLines.length * lhMeta +
      6 +
      lhLabel +
      lhBody +
      gap +
      lhLabel +
      issueLines.length * lhBody +
      gap +
      lhLabel +
      detailLines.length * lhBody +
      gap +
      lhLabel +
      fixLines.length * lhBody +
      cardInset

    if (y + cardH > pageH - 36) newPage()

    const x0 = mx
    const y0 = y

    doc.setFillColor(...PDF.card)
    doc.setDrawColor(...PDF.border)
    doc.setLineWidth(0.45)
    doc.roundedRect(x0, y0, contentW, cardH, 8, 8, 'FD')

    let cy = y0 + cardInset
    const tx = x0 + cardInset

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...PDF.ink)
    for (const ml of metaLines) {
      doc.text(ml, tx, cy)
      cy += lhMeta
    }

    cy += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...PDF.slate500)
    doc.text('SEVERITY', tx, cy)
    cy += lhLabel
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...sevRgb)
    doc.text(sevLabel, tx, cy)
    cy += lhBody + gap

    const label = (t: string) => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...PDF.slate500)
      doc.text(t, tx, cy)
      cy += lhLabel
    }

    const body = (lines: string[], rgb: [number, number, number], bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...rgb)
      for (const ln of lines) {
        doc.text(ln, tx, cy)
        cy += lhBody
      }
    }

    label('ISSUE')
    body(issueLines, item.source === 'comp1' ? PDF.err : PDF.warn, false)
    cy += gap - 2

    label('DETAILS')
    body(detailLines, PDF.slate700, false)
    cy += gap - 2

    label('RECOMMENDED FIX')
    body(fixLines, PDF.fix, false)

    y = y0 + cardH + 14
  })

  doc.setCharSpace(0)
  return y
}

export interface CombinedPdfParams {
  selectedOption: AnalysisOption
  ruleProfile: string
  feedbackResult: FeedbackGenerateResult
  errorReport: ErrorReportItem[]
  comp2Result: Comp2Result | null
}

export async function downloadCombinedAnalysisPdf({
  selectedOption,
  ruleProfile,
  feedbackResult,
  errorReport,
  comp2Result,
}: CombinedPdfParams): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const mx = 48
  const contentW = Math.floor(pageW - mx * 2)
  const now = new Date()
  const stamp = now.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const headerH = 108
  doc.setFillColor(...PDF.headerBg)
  doc.rect(0, 0, pageW, headerH, 'F')
  doc.setFillColor(...PDF.headerAccent)
  doc.rect(0, headerH - 3, pageW, 3, 'F')

  doc.setTextColor(248, 250, 252)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('Combined Analysis Report', mx, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(203, 213, 225)
  doc.text(`Generated ${stamp}`, mx, 62)
  doc.text(`Analysis: ${OPTION_TITLE[selectedOption]}`, mx, 76)
  if (selectedOption === 'rules' || selectedOption === 'all') {
    doc.text(`Rule category: ${ruleProfileLabel(ruleProfile)}`, mx, 90)
  }

  let y = headerH + 28

  const drawSectionTitle = (title: string, yy: number) => {
    doc.setFillColor(...PDF.headerAccent)
    doc.rect(mx, yy - 12, 3, 14, 'F')
    doc.setTextColor(...PDF.ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(title, mx + 12, yy)
  }

  const high = errorReport.filter(i => i.severity === 'high').length
  const med = errorReport.filter(i => i.severity === 'medium').length
  const low = errorReport.filter(i => i.severity === 'low').length
  const rulesN = errorReport.filter(i => i.source === 'comp1').length
  const elemN = errorReport.filter(i => i.source === 'comp2').length

  drawSectionTitle('Findings overview', y)
  y += 22

  const chipGap = 10
  const chipH = 58
  const innerW = contentW
  type Chip = { label: string; value: string; bg: [number, number, number]; fg: [number, number, number] }
  const chips: Chip[] = [
    { label: 'Flagged', value: String(errorReport.length), bg: PDF.surface, fg: PDF.ink },
    { label: 'High', value: String(high), bg: PDF.highBg, fg: PDF.high },
    { label: 'Medium', value: String(med), bg: PDF.medBg, fg: PDF.med },
    { label: 'Low', value: String(low), bg: PDF.lowBg, fg: PDF.low },
  ]
  const nChips = chips.length
  const chipW = (innerW - chipGap * (nChips - 1)) / nChips
  let cx = mx
  for (const c of chips) {
    doc.setFillColor(...c.bg)
    doc.setDrawColor(...PDF.border)
    doc.setLineWidth(0.4)
    doc.roundedRect(cx, y, chipW, chipH, 6, 6, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...PDF.slate500)
    doc.text(c.label.toUpperCase(), cx + 12, y + 18)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...c.fg)
    doc.text(c.value, cx + 12, y + 44)
    cx += chipW + chipGap
  }
  y += chipH + 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...PDF.slate500)
  const metaBits: string[] = []
  if (selectedOption === 'rules' || selectedOption === 'all') {
    metaBits.push(`Rule violations: ${rulesN}`)
  }
  if (selectedOption === 'elements' || selectedOption === 'all') {
    metaBits.push(`Low-similarity elements: ${elemN}`)
  }
  if (metaBits.length) {
    doc.text(metaBits.join('   ·   '), mx, y)
    y += 16
  } else {
    y += 4
  }

  // ── Issues & fixes (colour-coded by source) ──────────────────────
  drawSectionTitle('Issues, details & recommended fixes', y)
  y += 18

  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(...PDF.border)
  doc.setLineWidth(0.35)
  doc.roundedRect(mx, y, pageW - mx * 2, 36, 6, 6, 'FD')
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...PDF.slate500)
  doc.text(
    'Legend: V-n = rule violation # · E-n = element #. Screenshots: ERR (red) / FIX (green). Each card is one finding.',
    mx + 12,
    y + 14,
    { maxWidth: pageW - mx * 2 - 24 },
  )
  y += 48
  doc.setFont('helvetica', 'normal')

  if (errorReport.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...PDF.fix)
    doc.text('No issues reported for this analysis — all checks passed.', mx, y + 24)
    y += 40
  } else {
    y = renderIssueCardsPdf(doc, errorReport, y + 4, mx, contentW, pageH)
  }

  // ── Appendix: all element scores (when element audit ran) ───────
  if (comp2Result?.components?.length && (selectedOption === 'elements' || selectedOption === 'all')) {
    if (y > pageH - 120) {
      doc.addPage()
      y = 48
    }
    doc.setFillColor(...PDF.headerAccent)
    doc.rect(mx, y - 12, 3, 14, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...PDF.ink)
    doc.text('Appendix: all detected elements & scores', mx + 12, y)
    y += 10

    const scoreRows = comp2Result.components.map((c, idx) => {
      const num = c.id ?? idx + 1
      return [
        String(num),
        c.class,
        `${c.similarity_score}%`,
        `${(c.confidence * 100).toFixed(1)}%`,
        c.matched_expert || '—',
      ]
    })

    doc.setCharSpace(0)
    const wrapTableCell = pdfTableCellOverflow(doc)
    autoTable(doc, {
      startY: y,
      margin: { left: mx, right: mx },
      tableWidth: contentW,
      theme: 'plain',
      head: [['Element #', 'Class', 'Similarity', 'Confidence', 'Matched expert']],
      body: scoreRows,
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 8,
        lineColor: PDF.border,
        lineWidth: 0.15,
        textColor: PDF.slate700,
        valign: 'top',
        halign: 'left',
        overflow: wrapTableCell as OverflowType,
      },
      headStyles: {
        fillColor: PDF.ink,
        textColor: [248, 250, 252],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: 10,
        overflow: wrapTableCell as OverflowType,
      },
      bodyStyles: { overflow: wrapTableCell as OverflowType },
      alternateRowStyles: { fillColor: PDF.surface },
      columnStyles: {
        0: { cellWidth: 52, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 100 },
        2: { cellWidth: 70, halign: 'right' },
        3: { cellWidth: 70, halign: 'right' },
        4: { cellWidth: 'auto' },
      },
      didParseCell: data => {
        if (data.section !== 'body' || data.column.index !== 2) return
        const c = comp2Result.components[data.row.index]
        if (!c) return
        const s = c.similarity_score
        const rgb: [number, number, number] =
          s >= 70 ? [22, 163, 74] : s >= 50 ? [217, 119, 6] : [220, 38, 38]
        data.cell.styles.textColor = rgb
        if (s < 70) data.cell.styles.fontStyle = 'bold'
      },
    })
    doc.setCharSpace(0)
    y = (doc as any).lastAutoTable.finalY + 28
  }

  // ── Annotated screenshots (highlighted UI) ────────────────────────
  const phases: { key: keyof FeedbackGenerateResult['images']; label: string }[] = [
    { key: 'phase1_technical', label: 'Annotated UI (technical highlights)' },
    { key: 'phase2_aesthetic', label: 'Aesthetic / element emphasis' },
    { key: 'phase3_synthesis', label: 'Combined synthesis view' },
  ]

  for (const { key, label } of phases) {
    const rel = feedbackResult.images[key]
    if (!rel) continue
    const dataUrl = await fetchImageAsDataUrl(`${BASE_URL}${rel}`)
    if (!dataUrl) continue

    doc.addPage()
    doc.setFillColor(...PDF.headerAccent)
    doc.rect(mx, 36, 3, 14, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...PDF.ink)
    doc.text(label, mx + 12, 48)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...PDF.slate500)
    doc.text(
      'Callouts are centered on each element. ERR text is red on a light-red band; FIX text is green on a light-green band. Numbers match the V-n / E-n references in the report table.',
      mx,
      64,
      { maxWidth: pageW - mx * 2 },
    )

    const img = new Image()
    await new Promise<void>(resolve => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = dataUrl
    })
    if (!img.naturalWidth) continue

    const maxW = pageW - mx * 2
    const maxH = pageH - 100
    const ar = img.naturalHeight / img.naturalWidth
    let w = maxW
    let h = w * ar
    if (h > maxH) {
      h = maxH
      w = h / ar
    }
    const ix = mx + (maxW - w) / 2
    const imgFmt = dataUrl.includes('image/png') ? 'PNG' : 'JPEG'
    try {
      doc.addImage(dataUrl, imgFmt, ix, 78, w, h, undefined, 'FAST')
    } catch {
      /* skip corrupt preview */
    }
  }

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...PDF.slate400)
    doc.text(`Smart UI Auditor · Combined Analysis · Page ${p} / ${totalPages}`, mx, pageH - 20)
  }

  const slug = selectedOption
  const fname = `combined-analysis_${slug}_${now.toISOString().slice(0, 10)}.pdf`
  doc.save(fname)
}

import { useState, useRef, useCallback, useEffect } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ElementCategoryDropdown from '../components/audit/ElementCategoryDropdown'
import { ELEMENT_AUDIT_CATEGORIES } from '../constants/elementAuditCategories'

interface AuditComponent {
    id?: number
    class: string
    confidence: number
    bbox: number[]
    similarity_score: number
    matched_expert: string
}

interface AuditResult {
    report_id: string
    overall_score: number
    grade: string
    total_components: number
    components: AuditComponent[]
    report_image_url: string
    image_size?: { width: number; height: number }
    error?: string
}

type AuditStep = 'upload' | 'uploaded' | 'processing' | 'results'

const zoomBtnStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    border: 'none',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
}

interface ElementAuditPageProps {
    onBack: () => void;
    onNext?: (result: AuditResult, imageUrl: string | null) => void;
    initialImageUrl?: string | null;
}

export default function ElementAuditPage({ onBack, onNext, initialImageUrl }: ElementAuditPageProps) {
    const [category, setCategory] = useState('universal')
    const [auditStep, setAuditStep] = useState<AuditStep>('upload')
    const [result, setResult] = useState<AuditResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
    const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(initialImageUrl || null)
    const [zoomOpen, setZoomOpen] = useState(false)
    const [zoomScale, setZoomScale] = useState(1)
    const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const zoomImgRef = useRef<HTMLImageElement>(null)
    const [zoomImgDisplay, setZoomImgDisplay] = useState<{ w: number; h: number } | null>(null)

    // --- Interactive overlay state ---
    const [hoveredId, setHoveredId] = useState<number | null>(null)
    const [activeId, setActiveId] = useState<number | null>(null)
    const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
    const imageWrapperRef = useRef<HTMLDivElement>(null)
    const reportImgRef = useRef<HTMLImageElement>(null)
    const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null)
    const [imgDisplay, setImgDisplay] = useState<{ w: number; h: number } | null>(null)

    // Measure the rendered image size whenever it loads or the window resizes.
    useEffect(() => {
        const measure = () => {
            const el = reportImgRef.current
            if (!el) return
            if (el.naturalWidth && el.naturalHeight) {
                setImgNatural({ w: el.naturalWidth, h: el.naturalHeight })
            }
            setImgDisplay({ w: el.clientWidth, h: el.clientHeight })
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [result?.report_image_url])

    const jumpToComponent = (id: number) => {
        const card = cardRefs.current[id]
        if (!card) return
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setActiveId(id)
        window.setTimeout(() => {
            setActiveId(prev => (prev === id ? null : prev))
        }, 2200)
    }

    const jumpToImage = (id: number) => {
        imageWrapperRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setActiveId(id)
        window.setTimeout(() => {
            setActiveId(prev => (prev === id ? null : prev))
        }, 2200)
    }

    const colorForScore = (score: number) =>
        score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'

    // Convert remote image URL → base64 data URL so jsPDF can embed it.
    const fetchImageAsDataUrl = async (url: string): Promise<{
        dataUrl: string; width: number; height: number
    } | null> => {
        try {
            const resp = await fetch(url, { mode: 'cors' })
            const blob = await resp.blob()
            return await new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onerror = () => reject(reader.error)
                reader.onload = () => {
                    const dataUrl = reader.result as string
                    const img = new Image()
                    img.onload = () => resolve({
                        dataUrl,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                    })
                    img.onerror = () => resolve({ dataUrl, width: 0, height: 0 })
                    img.src = dataUrl
                }
                reader.readAsDataURL(blob)
            })
        } catch (e) {
            console.warn('Failed to embed report image in PDF:', e)
            return null
        }
    }

    /**
     * Load the annotated image, composite colored numbered badges on top
     * of each bounding box, and return a PNG data URL ready for jsPDF.
     * Bboxes are in *original* image coordinates (result.image_size), so we
     * scale them to the displayed annotated-image resolution.
     */
    const buildAnnotatedImageWithBadges = async (
        imageUrl: string,
        components: AuditComponent[],
        originalSize?: { width: number; height: number }
    ): Promise<{ dataUrl: string; width: number; height: number } | null> => {
        try {
            const resp = await fetch(imageUrl, { mode: 'cors' })
            const blob = await resp.blob()
            const objectUrl = URL.createObjectURL(blob)
            const img: HTMLImageElement = await new Promise((resolve, reject) => {
                const el = new Image()
                el.onload = () => resolve(el)
                el.onerror = () => reject(new Error('image load failed'))
                el.src = objectUrl
            })

            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                URL.revokeObjectURL(objectUrl)
                return null
            }
            ctx.drawImage(img, 0, 0)

            const scaleX = originalSize?.width
                ? canvas.width / originalSize.width : 1
            const scaleY = originalSize?.height
                ? canvas.height / originalSize.height : 1

            // Badge size proportional to image so it reads in the PDF.
            const badgeRadius = Math.max(14, Math.round(canvas.width * 0.014))
            const fontSize = Math.round(badgeRadius * 1.3)
            ctx.font = `bold ${fontSize}px Arial, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'

            components.forEach((c, idx) => {
                const id = c.id ?? idx + 1
                const [x1, y1, x2] = c.bbox
                // Place badge at the top-right corner of the bbox,
                // nudged slightly inside so it doesn't clip.
                const cx = Math.min(
                    canvas.width - badgeRadius - 2,
                    Math.max(badgeRadius + 2, x2 * scaleX - badgeRadius * 0.4)
                )
                const cy = Math.max(
                    badgeRadius + 2,
                    Math.min(canvas.height - badgeRadius - 2,
                        y1 * scaleY + badgeRadius * 0.4)
                )
                const score = c.similarity_score
                const fill =
                    score >= 70 ? '#10b981'
                        : score >= 50 ? '#f59e0b' : '#ef4444'

                ctx.save()
                ctx.shadowColor = 'rgba(0,0,0,0.35)'
                ctx.shadowBlur = 4
                ctx.shadowOffsetY = 1
                ctx.fillStyle = fill
                ctx.beginPath()
                ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2)
                ctx.fill()
                ctx.restore()

                ctx.lineWidth = Math.max(1.5, badgeRadius * 0.14)
                ctx.strokeStyle = '#ffffff'
                ctx.beginPath()
                ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2)
                ctx.stroke()

                ctx.fillStyle = '#ffffff'
                ctx.fillText(String(id), cx, cy + fontSize * 0.05)
                // Suppress unused-var lint: y2 not needed here.
                void x1; void x2
            })

            const dataUrl = canvas.toDataURL('image/png')
            URL.revokeObjectURL(objectUrl)
            return { dataUrl, width: canvas.width, height: canvas.height }
        } catch (e) {
            console.warn('Failed to build badge-annotated image:', e)
            return fetchImageAsDataUrl(imageUrl)
        }
    }

    const [exportingPdf, setExportingPdf] = useState(false)

    const downloadPdfReport = async () => {
        if (!result) return
        setExportingPdf(true)
        try {
            const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
            const pageW = doc.internal.pageSize.getWidth()
            const pageH = doc.internal.pageSize.getHeight()
            const marginX = 40

            // ── Header ────────────────────────────────────────────────
            doc.setFillColor(17, 24, 39)
            doc.rect(0, 0, pageW, 86, 'F')
            doc.setTextColor(255, 255, 255)
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(20)
            doc.text('UI Element Audit Report', marginX, 38)
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(10)
            doc.setTextColor(200, 210, 225)
            const now = new Date()
            const stamp = now.toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            })
            const activeCategory =
                ELEMENT_AUDIT_CATEGORIES.find(c => c.value === category)?.label
                || 'Universal (all categories)'
            doc.text(
                `Generated ${stamp}  ·  Report ID: ${result.report_id}`,
                marginX, 58
            )
            doc.setTextColor(180, 220, 180)
            doc.text(`Scored against: ${activeCategory}`, marginX, 70)

            // ── Summary cards ─────────────────────────────────────────
            let cursorY = 110
            const cardW = (pageW - marginX * 2 - 20) / 3
            const cardH = 72
            const gradeColor =
                result.overall_score >= 70 ? [16, 185, 129]
                    : result.overall_score >= 50 ? [245, 158, 11]
                        : [239, 68, 68]

            const drawSummaryCard = (
                x: number, label: string, value: string,
                accent: [number, number, number], emphasis = false
            ) => {
                doc.setDrawColor(229, 231, 235)
                doc.setFillColor(249, 250, 251)
                doc.roundedRect(x, cursorY, cardW, cardH, 8, 8, 'FD')
                doc.setFillColor(accent[0], accent[1], accent[2])
                doc.roundedRect(x, cursorY, 4, cardH, 2, 2, 'F')
                doc.setTextColor(107, 114, 128)
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(9)
                doc.text(label.toUpperCase(), x + 16, cursorY + 20)
                doc.setTextColor(17, 24, 39)
                doc.setFontSize(emphasis ? 26 : 22)
                doc.text(value, x + 16, cursorY + 52)
            }

            drawSummaryCard(marginX, 'Total Components',
                String(result.total_components), [59, 130, 246])
            drawSummaryCard(marginX + cardW + 10, 'Overall Score',
                `${result.overall_score}%`,
                gradeColor as [number, number, number], true)
            drawSummaryCard(marginX + (cardW + 10) * 2, 'Grade',
                result.grade, gradeColor as [number, number, number])

            cursorY += cardH + 24

            // ── Legend ────────────────────────────────────────────────
            doc.setFontSize(9)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(55, 65, 81)
            doc.text('Score bands:', marginX, cursorY)
            doc.setFont('helvetica', 'normal')
            const drawLegendDot = (x: number, color: [number, number, number], label: string) => {
                doc.setFillColor(color[0], color[1], color[2])
                doc.circle(x + 4, cursorY - 3, 4, 'F')
                doc.setTextColor(55, 65, 81)
                doc.text(label, x + 13, cursorY)
            }
            drawLegendDot(marginX + 70, [16, 185, 129], 'Good  (≥ 70%)')
            drawLegendDot(marginX + 190, [245, 158, 11], 'Needs review  (50–70%)')
            drawLegendDot(marginX + 350, [239, 68, 68], 'Poor  (< 50%)')
            cursorY += 18

            // ── Annotated image (with numbered badges baked in) ───────
            const imgInfo = await buildAnnotatedImageWithBadges(
                `http://localhost:8000${result.report_image_url}`,
                result.components,
                result.image_size,
            )
            if (imgInfo && imgInfo.width > 0) {
                const maxImgW = pageW - marginX * 2
                const maxImgH = 320
                const aspect = imgInfo.height / imgInfo.width
                let drawW = maxImgW
                let drawH = drawW * aspect
                if (drawH > maxImgH) {
                    drawH = maxImgH
                    drawW = drawH / aspect
                }
                const imgX = marginX + (maxImgW - drawW) / 2
                doc.setFont('helvetica', 'bold')
                doc.setFontSize(12)
                doc.setTextColor(17, 24, 39)
                doc.text('Annotated Report', marginX, cursorY + 4)
                cursorY += 12
                try {
                    doc.addImage(imgInfo.dataUrl, 'PNG', imgX, cursorY,
                        drawW, drawH, undefined, 'FAST')
                    cursorY += drawH + 20
                } catch (e) {
                    console.warn('addImage failed, skipping image block:', e)
                }
            }

            // ── Components table ──────────────────────────────────────
            if (cursorY > pageH - 140) {
                doc.addPage()
                cursorY = 60
            }
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(13)
            doc.setTextColor(17, 24, 39)
            doc.text(`Detected Components (${result.components.length})`,
                marginX, cursorY)
            cursorY += 10

            const tableRows = result.components.map((c, i) => {
                const id = c.id ?? i + 1
                return [
                    String(id),
                    c.class,
                    `${c.similarity_score}%`,
                    `${(c.confidence * 100).toFixed(1)}%`,
                    c.matched_expert || 'N/A',
                ]
            })

            autoTable(doc, {
                startY: cursorY,
                margin: { left: marginX, right: marginX },
                head: [['#', 'Class', 'Similarity', 'Confidence', 'Matched Expert']],
                body: tableRows,
                styles: {
                    font: 'helvetica',
                    fontSize: 9,
                    cellPadding: { top: 6, right: 8, bottom: 6, left: 8 },
                    textColor: [31, 41, 55],
                    lineColor: [229, 231, 235],
                    lineWidth: 0.5,
                },
                headStyles: {
                    fillColor: [17, 24, 39],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold',
                    fontSize: 9,
                    halign: 'left',
                },
                alternateRowStyles: { fillColor: [249, 250, 251] },
                columnStyles: {
                    0: { cellWidth: 32, halign: 'center', fontStyle: 'bold' },
                    1: { cellWidth: 90 },
                    2: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
                    3: { cellWidth: 70, halign: 'right' },
                    4: { cellWidth: 'auto' },
                },
                didParseCell: (data) => {
                    if (data.section !== 'body') return
                    const rowIdx = data.row.index
                    const comp = result.components[rowIdx]
                    if (!comp) return
                    // Color the # cell and the Similarity cell according to score.
                    const score = comp.similarity_score
                    const rgb: [number, number, number] =
                        score >= 70 ? [16, 185, 129]
                            : score >= 50 ? [245, 158, 11]
                                : [239, 68, 68]
                    if (data.column.index === 0) {
                        data.cell.styles.fillColor = rgb
                        data.cell.styles.textColor = [255, 255, 255]
                    }
                    if (data.column.index === 2) {
                        data.cell.styles.textColor = rgb
                    }
                },
            })

            // ── Footer on every page ──────────────────────────────────
            const pageCount = doc.getNumberOfPages()
            for (let p = 1; p <= pageCount; p++) {
                doc.setPage(p)
                doc.setFont('helvetica', 'normal')
                doc.setFontSize(8)
                doc.setTextColor(156, 163, 175)
                doc.text(
                    `Smart UI Auditor  ·  Page ${p} of ${pageCount}`,
                    marginX, pageH - 20
                )
                doc.text(
                    `Generated ${now.toISOString()}`,
                    pageW - marginX, pageH - 20, { align: 'right' }
                )
            }

            const filename =
                `ui-audit_${result.report_id}_${now.toISOString().slice(0, 10)}.pdf`
            doc.save(filename)
        } catch (err) {
            console.error('PDF generation failed:', err)
            alert(`Failed to generate PDF report: ${String(err)}`)
        } finally {
            setExportingPdf(false)
        }
    }

    // Reusable overlay-badge renderer — used by both the inline image and the
    // zoom lightbox, so interactions stay identical.
    const renderOverlayBadges = ({ displayW, displayH, isZoomView }:
        { displayW: number; displayH: number; isZoomView: boolean }) => {
        if (!result || !result.components) return null
        const origW = result.image_size?.width ?? (imgNatural?.w || displayW)
        const origH = result.image_size?.height ?? (imgNatural?.h || displayH)
        const sx = displayW / origW
        const sy = displayH / origH
        // In the zoom view the parent has transform: scale(zoomScale). Counter-
        // scale the badge and tooltip so they stay a readable, constant size
        // regardless of how far the user has zoomed in.
        const counterScale = isZoomView ? 1 / Math.max(0.5, zoomScale) : 1
        return result.components.map((comp, i) => {
            const id = comp.id ?? i + 1
            const [bx1, by1, bx2, by2] = comp.bbox
            const left = bx1 * sx
            const top = by1 * sy
            const bboxWidth = Math.max(0, (bx2 - bx1) * sx)
            const bboxHeight = Math.max(0, (by2 - by1) * sy)
            const color = colorForScore(comp.similarity_score)
            const isHovered = hoveredId === id
            const isActiveBadge = activeId === id

            // Where should the tooltip go? Prefer below-right, fall back above
            // if we're near the bottom of the container.
            const tooltipBelow = top + bboxHeight < displayH - 130

            return (
                <div
                    key={id}
                    style={{
                        position: 'absolute',
                        left, top,
                        pointerEvents: 'none',
                        zIndex: isHovered || isActiveBadge ? 6 : 2,
                        transform: `scale(${counterScale})`,
                        transformOrigin: 'top left',
                    }}
                >
                    <button
                        type="button"
                        className={`audit-overlay-badge${isHovered ? ' is-hover' : ''}${isActiveBadge ? ' is-active' : ''}`}
                        style={{
                            position: 'relative',
                            left: 0, top: 0,
                            background: color,
                            pointerEvents: 'auto',
                        }}
                        onMouseEnter={() => setHoveredId(id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation()
                            if (isZoomView) {
                                closeZoom()
                                window.setTimeout(() => jumpToComponent(id), 180)
                            } else {
                                jumpToComponent(id)
                            }
                        }}
                        aria-label={`Go to component ${id}: ${comp.class}, similarity ${comp.similarity_score}%`}
                    >
                        {id}
                    </button>

                    {isHovered && (
                        <div
                            role="tooltip"
                            className="audit-overlay-tooltip"
                            style={{
                                position: 'absolute',
                                left: 18,
                                top: tooltipBelow ? 18 : undefined,
                                bottom: tooltipBelow ? undefined : 18,
                                pointerEvents: 'none',
                            }}
                        >
                            <div className="audit-overlay-tooltip__row">
                                <span className="audit-overlay-tooltip__id" style={{ background: color }}>
                                    #{id}
                                </span>
                                <span className="audit-overlay-tooltip__class">{comp.class}</span>
                            </div>
                            <div className="audit-overlay-tooltip__scores">
                                <span className="audit-overlay-tooltip__metric">
                                    <span className="audit-overlay-tooltip__metric-label">Similarity</span>
                                    <span
                                        className="audit-overlay-tooltip__metric-value"
                                        style={{ color }}
                                    >
                                        {comp.similarity_score}%
                                    </span>
                                </span>
                                <span className="audit-overlay-tooltip__metric">
                                    <span className="audit-overlay-tooltip__metric-label">Confidence</span>
                                    <span className="audit-overlay-tooltip__metric-value">
                                        {(comp.confidence * 100).toFixed(1)}%
                                    </span>
                                </span>
                            </div>
                            {comp.matched_expert && comp.matched_expert !== 'N/A' && (
                                <div className="audit-overlay-tooltip__match">
                                    Matched: {comp.matched_expert}
                                </div>
                            )}
                            <div className="audit-overlay-tooltip__hint">
                                {isZoomView ? 'Click to close zoom and view details' : 'Click to view details below'}
                            </div>
                        </div>
                    )}
                </div>
            )
        })
    }

    const openZoom = () => {
        setZoomScale(1)
        setZoomOffset({ x: 0, y: 0 })
        setZoomOpen(true)
    }
    const closeZoom = () => setZoomOpen(false)

    useEffect(() => {
        if (!zoomOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeZoom()
            else if (e.key === '+' || e.key === '=') setZoomScale(s => Math.min(6, s * 1.2))
            else if (e.key === '-' || e.key === '_') setZoomScale(s => Math.max(0.5, s / 1.2))
            else if (e.key === '0') { setZoomScale(1); setZoomOffset({ x: 0, y: 0 }) }
        }
        document.addEventListener('keydown', onKey)
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        // Measure the zoom image after it mounts (image may already be cached
        // from the main view, in which case onLoad doesn't fire again).
        const measureZoomImg = () => {
            const el = zoomImgRef.current
            if (el && el.clientWidth && el.clientHeight) {
                setZoomImgDisplay({ w: el.clientWidth, h: el.clientHeight })
            }
        }
        const t1 = window.setTimeout(measureZoomImg, 50)
        const t2 = window.setTimeout(measureZoomImg, 250)

        return () => {
            document.removeEventListener('keydown', onKey)
            document.body.style.overflow = prevOverflow
            window.clearTimeout(t1)
            window.clearTimeout(t2)
        }
    }, [zoomOpen])

    const simulateUpload = useCallback((file: File) => {
        const imageUrl = URL.createObjectURL(file)
        setPreviewUrl(imageUrl)
        setSelectedFile(file)
        setUploadedFileName(file.name)
        setUploadedFileSize(`${(file.size / 1024 / 1024).toFixed(1)}MB`)
        setUploadProgress(0)
        setError(null)
        setAuditStep('uploaded')

        let progress = 0
        const interval = setInterval(() => {
            progress += Math.random() * 15 + 5
            if (progress >= 100) {
                progress = 100
                clearInterval(interval)
            }
            setUploadProgress(progress)
        }, 300)
    }, [])

    const handleProcessAudit = useCallback(async (fileToAudit?: File | string) => {
        const source = fileToAudit || selectedFile || previewUrl;
        if (!source) return;

        setAuditStep('processing')
        setError(null)

        const formData = new FormData()

        if (typeof source === 'string') {
            // If it's a URL (blob), we need to fetch it first to send as a file
            try {
                const response = await fetch(source);
                const blob = await response.blob();
                formData.append('file', blob, 'design.png');
            } catch (err) {
                console.error('Failed to fetch initial image:', err);
                setError('Failed to load initial image.');
                setAuditStep('upload');
                return;
            }
        } else {
            formData.append('file', source)
        }

        // Tell the backend which expert-library category to score against.
        formData.append('category', category)

        try {
            const response = await fetch('http://localhost:8000/audit', {
                method: 'POST',
                body: formData,
            })
            const data: AuditResult = await response.json()

            if (data.error) {
                setError(data.error)
                setAuditStep('uploaded')
                return
            }

            setResult(data)
            setAuditStep('results')
        } catch (err) {
            console.error('Element audit failed:', err)
            setError('Audit failed. Please ensure the server is running on port 8000.')
            setAuditStep('uploaded')
        }
    }, [selectedFile, previewUrl, category])

    // Handle initialImageUrl by setting it to preview state instead of auto-processing
    useEffect(() => {
        if (initialImageUrl) {
            setPreviewUrl(initialImageUrl);
            setUploadedFileName('design-from-previous-step.png');
            setUploadedFileSize('---');
            setUploadProgress(100);
            setAuditStep('uploaded');
        }
    }, [initialImageUrl]);

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f && f.type.startsWith('image/')) simulateUpload(f)
    }, [simulateUpload])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (f) simulateUpload(f)
    }, [simulateUpload])

    const getScoreColor = (score: number) => {
        if (score >= 70) return 'green'
        if (score >= 50) return 'amber'
        return 'red'
    }

    const getGradeClass = (grade: string) => {
        switch (grade) {
            case 'EXCELLENT': return 'grade--excellent'
            case 'GOOD': return 'grade--good'
            default: return 'grade--needs-work'
        }
    }

    // Upload view
    if (auditStep === 'upload') {
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        onClick={onBack}
                        className="back-button-circle"
                        title="Back to Home"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>
                <p className="page-subheading">
                    Upload a UI screenshot to detect and score individual elements against expert design patterns.
                </p>

                <ElementCategoryDropdown value={category} onChange={setCategory} />

                {error && (
                    <div className="audit-error">
                        <span>⚠️</span> {error}
                    </div>
                )}

                <div
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="upload-zone__icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                    </div>
                    <p className="upload-zone__text">
                        Drag & Drop or <span>Choose file</span> to upload
                    </p>
                    <p className="upload-zone__formats">png, jpg, jpeg</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpeg,.jpg"
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                </div>
            </div>
        )
    }

    // Uploaded view — shows upload progress, image preview, and Process Interface button
    if (auditStep === 'uploaded') {
        const isUploadComplete = uploadProgress >= 100
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        onClick={() => {
                            setAuditStep('upload')
                            setPreviewUrl(null)
                            setSelectedFile(null)
                            setUploadProgress(0)
                            setUploadedFileName(null)
                            setUploadedFileSize(null)
                        }}
                        className="back-button-circle"
                        title="Back to Upload"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>

                <ElementCategoryDropdown value={category} onChange={setCategory} />

                {error && (
                    <div className="audit-error">
                        <span>⚠️</span> {error}
                    </div>
                )}

                {/* Upload Progress Bar */}
                {uploadedFileName && (
                    <div className="file-progress mt-6">
                        <div className="file-progress__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <rect width="24" height="24" rx="4" fill="#7C4DFF" fillOpacity="0.1" />
                                <path d="M7 7h10v10H7z" fill="#7C4DFF" fillOpacity="0.3" />
                            </svg>
                        </div>
                        <div className="file-progress__info">
                            <div className="file-progress__name">{uploadedFileName}</div>
                            <div className="file-progress__meta">
                                {uploadedFileSize} • {isUploadComplete ? 'Complete' : '1 minute left'}
                            </div>
                            <div className="file-progress__bar">
                                <div
                                    className="file-progress__bar-fill"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                        <div className="file-progress__percent">{Math.round(uploadProgress)}%</div>
                    </div>
                )}

                {/* Image Preview */}
                {isUploadComplete && previewUrl && (
                    <div style={{ marginTop: '2rem', border: '2px dashed var(--border-light)', borderRadius: 'var(--radius-lg)', padding: '1rem' }}>
                        <h3 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Preview</h3>
                        <div style={{
                            background: '#f5f5f5',
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            maxHeight: 350
                        }}>
                            <img
                                src={previewUrl}
                                alt="Uploaded UI Preview"
                                style={{
                                    maxWidth: '100%',
                                    maxHeight: 350,
                                    objectFit: 'contain',
                                    borderRadius: 8
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Process Interface Button */}
                <div className="footer-actions">
                    <button
                        className="btn btn-primary btn-primary-lg"
                        onClick={() => handleProcessAudit()}
                        style={{ opacity: isUploadComplete ? 1 : 0.5, width: '100%', maxWidth: 400 }}
                        disabled={!isUploadComplete}
                    >
                        Process Interface
                    </button>
                </div>
            </div>
        )
    }

    // Processing view
    if (auditStep === 'processing') {
        return (
            <div className="element-audit" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        onClick={onBack}
                        className="back-button-circle"
                        title="Back to Home"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h1 className="page-heading" style={{ margin: 0 }}>UI Element Auditor</h1>
                </div>
                <div className="spinner-container">
                    <div className="spinner" />
                    <div className="spinner-text">Analyzing UI Elements</div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                        Detecting components and scoring against expert patterns…
                    </p>
                </div>
            </div>
        )
    }

    // Results view
    if (!result) return null

    return (
        <div className="element-audit" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <button
                    onClick={onBack}
                    className="back-button-circle"
                    title="Back to Home"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <h1 className="page-heading" style={{ margin: 0 }}>Audit Results</h1>
            </div>

            {/* Overall Score Section */}
            <div className="audit-overview">
                <div className={`grade-badge ${getGradeClass(result.grade)}`}>
                    <span className="grade-badge__score">{result.overall_score}%</span>
                    <span className="grade-badge__label">{result.grade}</span>
                </div>
                <div className="audit-overview__stats">
                    <div className="stat-cards">
                        <div className="stat-card stat-card--blue">
                            <div className="stat-card__label">Components Found</div>
                            <div className="stat-card__value">{result.total_components}</div>
                        </div>
                        <div className={`stat-card ${result.overall_score >= 70 ? 'stat-card--green' : result.overall_score >= 50 ? 'stat-card--blue' : 'stat-card--red'}`}>
                            <div className="stat-card__label">Overall Score</div>
                            <div className="stat-card__value">{result.overall_score}%</div>
                        </div>
                        <div className="stat-card stat-card--green">
                            <div className="stat-card__label">Grade</div>
                            <div className="stat-card__value">{result.grade}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Annotated Report Image */}
            <style>{`
                @keyframes auditBadgePulse {
                    0%   { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); transform: scale(1); }
                    50%  { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0); transform: scale(1.35); }
                    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); transform: scale(1); }
                }
                @keyframes auditCardFlash {
                    0%   { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.55); background-color: rgba(219, 234, 254, 0.55); }
                    60%  { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); background-color: rgba(219, 234, 254, 0.2); }
                    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); background-color: transparent; }
                }
                .audit-overlay-badge {
                    position: absolute;
                    min-width: 26px; height: 26px; padding: 0 6px;
                    border-radius: 999px;
                    border: 2px solid #fff;
                    color: #fff; font-size: 13px; font-weight: 700;
                    display: inline-flex; align-items: center; justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
                    transition: transform 120ms ease-out, box-shadow 120ms ease-out, min-width 120ms ease-out;
                    transform: translate(-30%, -30%);
                    z-index: 2;
                    user-select: none;
                }
                .audit-overlay-badge:hover,
                .audit-overlay-badge.is-hover {
                    transform: translate(-30%, -30%) scale(1.25);
                    z-index: 4;
                }
                .audit-overlay-badge.is-active {
                    animation: auditBadgePulse 1.4s ease-out 1;
                    z-index: 5;
                }
                .audit-component-card.is-active {
                    animation: auditCardFlash 2.2s ease-out 1;
                    outline: 2px solid rgba(59, 130, 246, 0.7);
                    outline-offset: 2px;
                }
                .audit-overlay-tooltip {
                    min-width: 220px;
                    max-width: 280px;
                    background: #ffffff;
                    color: #111827;
                    border: 1px solid rgba(17, 24, 39, 0.08);
                    border-radius: 10px;
                    padding: 10px 12px;
                    box-shadow:
                        0 12px 28px rgba(17, 24, 39, 0.18),
                        0 4px 10px rgba(17, 24, 39, 0.08);
                    font-size: 13px;
                    line-height: 1.35;
                    z-index: 10;
                    animation: auditTooltipIn 140ms ease-out;
                }
                .audit-overlay-tooltip__row {
                    display: flex; align-items: center; gap: 8px;
                    margin-bottom: 8px;
                }
                .audit-overlay-tooltip__id {
                    display: inline-flex; align-items: center; justify-content: center;
                    min-width: 26px; height: 22px; padding: 0 7px;
                    border-radius: 999px;
                    color: #fff; font-weight: 700; font-size: 12px;
                }
                .audit-overlay-tooltip__class {
                    font-weight: 700; font-size: 13px; color: #111827;
                    text-transform: capitalize;
                }
                .audit-overlay-tooltip__scores {
                    display: flex; gap: 14px;
                    padding: 6px 0;
                    border-top: 1px solid rgba(17, 24, 39, 0.06);
                    border-bottom: 1px solid rgba(17, 24, 39, 0.06);
                    margin-bottom: 6px;
                }
                .audit-overlay-tooltip__metric {
                    display: flex; flex-direction: column; gap: 2px;
                }
                .audit-overlay-tooltip__metric-label {
                    font-size: 10.5px;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    font-weight: 600;
                }
                .audit-overlay-tooltip__metric-value {
                    font-size: 14px;
                    font-weight: 700;
                    color: #111827;
                }
                .audit-overlay-tooltip__match {
                    font-size: 11.5px;
                    color: #6b7280;
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .audit-overlay-tooltip__hint {
                    font-size: 11px;
                    color: #9ca3af;
                    font-style: italic;
                }
                @keyframes auditTooltipIn {
                    from { opacity: 0; transform: translateY(-2px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
            <div className="audit-report-image" ref={imageWrapperRef}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 style={{ fontWeight: 700, margin: 0 }}>Annotated Report</h3>
                    <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted, #6b7280)' }}>
                        Click any number to jump to its details · double-click image to zoom
                    </span>
                </div>
                <div
                    className="audit-report-image__container"
                    onDoubleClick={openZoom}
                    style={{ position: 'relative', cursor: 'default' }}
                    title="Double-click to zoom"
                >
                    <img
                        ref={reportImgRef}
                        src={`http://localhost:8000${result.report_image_url}`}
                        alt="Annotated UI audit report"
                        style={{ display: 'block', width: '100%', height: 'auto' }}
                        onLoad={(e) => {
                            const el = e.target as HTMLImageElement
                            setImgNatural({ w: el.naturalWidth, h: el.naturalHeight })
                            setImgDisplay({ w: el.clientWidth, h: el.clientHeight })
                        }}
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                        }}
                    />

                    {/* Interactive numbered overlay (main view) */}
                    {imgNatural && imgDisplay && renderOverlayBadges({
                        displayW: imgDisplay.w,
                        displayH: imgDisplay.h,
                        isZoomView: false,
                    })}

                    <div
                        aria-hidden
                        style={{
                            position: 'absolute',
                            bottom: 12,
                            right: 12,
                            background: 'rgba(17, 24, 39, 0.85)',
                            color: '#fff',
                            padding: '6px 10px',
                            borderRadius: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            pointerEvents: 'auto',
                            cursor: 'zoom-in',
                            zIndex: 3,
                        }}
                        onClick={openZoom}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                        Zoom
                    </div>
                </div>
            </div>

            {/* Zoom lightbox */}
            {zoomOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Annotated report — zoom view"
                    onClick={closeZoom}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        background: 'rgba(0, 0, 0, 0.88)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        userSelect: 'none',
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        onWheel={e => {
                            e.preventDefault()
                            const delta = -e.deltaY
                            setZoomScale(s => {
                                const next = delta > 0 ? s * 1.15 : s / 1.15
                                return Math.max(0.5, Math.min(8, next))
                            })
                        }}
                        onMouseDown={e => {
                            // Ignore drag if starting on an interactive element (badge)
                            const target = e.target as HTMLElement
                            if (target.closest('.audit-overlay-badge')) return
                            setIsDragging(true)
                            dragStartRef.current = {
                                x: e.clientX, y: e.clientY,
                                ox: zoomOffset.x, oy: zoomOffset.y,
                            }
                        }}
                        onMouseMove={e => {
                            if (!isDragging || !dragStartRef.current) return
                            setZoomOffset({
                                x: dragStartRef.current.ox + (e.clientX - dragStartRef.current.x),
                                y: dragStartRef.current.oy + (e.clientY - dragStartRef.current.y),
                            })
                        }}
                        onMouseUp={() => { setIsDragging(false); dragStartRef.current = null }}
                        onMouseLeave={() => { setIsDragging(false); dragStartRef.current = null }}
                        style={{
                            position: 'relative',
                            width: '95vw', height: '90vh',
                            overflow: 'hidden',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <div
                            style={{
                                position: 'relative',
                                display: 'inline-block',
                                maxWidth: '100%',
                                maxHeight: '100%',
                                transform: `translate(${zoomOffset.x}px, ${zoomOffset.y}px) scale(${zoomScale})`,
                                transformOrigin: 'center center',
                                transition: isDragging ? 'none' : 'transform 120ms ease-out',
                            }}
                        >
                            <img
                                ref={zoomImgRef}
                                src={`http://localhost:8000${result.report_image_url}`}
                                alt="Annotated UI audit report — zoomed"
                                draggable={false}
                                style={{
                                    display: 'block',
                                    maxWidth: '95vw',
                                    maxHeight: '90vh',
                                    imageRendering: 'crisp-edges',
                                    userSelect: 'none',
                                    pointerEvents: 'none',
                                }}
                                onLoad={(e) => {
                                    const el = e.target as HTMLImageElement
                                    setZoomImgDisplay({ w: el.clientWidth, h: el.clientHeight })
                                }}
                            />

                            {/* Interactive overlay inside the zoomed transform */}
                            {zoomImgDisplay && renderOverlayBadges({
                                displayW: zoomImgDisplay.w,
                                displayH: zoomImgDisplay.h,
                                isZoomView: true,
                            })}
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            position: 'fixed', bottom: 24, left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'rgba(17, 24, 39, 0.92)',
                            color: '#fff', padding: '8px 12px',
                            borderRadius: 999, boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                        }}
                    >
                        <button
                            onClick={() => setZoomScale(s => Math.max(0.5, s / 1.2))}
                            style={zoomBtnStyle}
                            aria-label="Zoom out"
                        >−</button>
                        <span style={{ minWidth: 56, textAlign: 'center', fontWeight: 600 }}>
                            {Math.round(zoomScale * 100)}%
                        </span>
                        <button
                            onClick={() => setZoomScale(s => Math.min(8, s * 1.2))}
                            style={zoomBtnStyle}
                            aria-label="Zoom in"
                        >+</button>
                        <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.25)', margin: '0 4px' }} />
                        <button
                            onClick={() => { setZoomScale(1); setZoomOffset({ x: 0, y: 0 }) }}
                            style={{ ...zoomBtnStyle, width: 'auto', padding: '0 12px', fontSize: 13 }}
                        >Reset</button>
                        <button
                            onClick={closeZoom}
                            style={{ ...zoomBtnStyle, width: 'auto', padding: '0 12px', fontSize: 13 }}
                            aria-label="Close zoom view"
                        >Close</button>
                    </div>
                </div>
            )}

            {/* Per-Component Results */}
            <h3 style={{ marginTop: 'var(--space-8)', marginBottom: 'var(--space-2)', fontWeight: 700 }}>
                Detected Components ({result.components.length})
            </h3>
            <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: 'var(--font-sm)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
                Each card below corresponds to a numbered badge on the annotated image above.
            </p>
            <div className="audit-components">
                {result.components.map((comp, i) => {
                    const badgeId = comp.id ?? i + 1
                    const badgeColor = comp.similarity_score >= 70
                        ? '#10b981'
                        : comp.similarity_score >= 50
                            ? '#f59e0b'
                            : '#ef4444'
                    const isActive = activeId === badgeId
                    return (
                    <div
                        key={i}
                        ref={(el) => { cardRefs.current[badgeId] = el }}
                        className={`audit-component-card${isActive ? ' is-active' : ''}`}
                        style={{ position: 'relative', transition: 'outline 150ms ease-out' }}
                        onMouseEnter={() => setHoveredId(badgeId)}
                        onMouseLeave={() => setHoveredId(null)}
                    >
                        <div
                            aria-hidden
                            style={{
                                position: 'absolute',
                                top: -10,
                                left: -10,
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: badgeColor,
                                color: '#fff',
                                fontSize: 13,
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                                border: '2px solid #fff',
                            }}
                        >
                            {badgeId}
                        </div>
                        <button
                            type="button"
                            onClick={() => jumpToImage(badgeId)}
                            title="Locate on image"
                            aria-label={`Locate component ${badgeId} on the annotated image`}
                            style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                border: '1px solid var(--border-light, #e5e7eb)',
                                background: '#fff',
                                color: 'var(--text-muted, #6b7280)',
                                padding: '4px 8px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                            </svg>
                            View
                        </button>
                        <div className="audit-component-card__header">
                            <span className="audit-component-card__class">{comp.class}</span>
                            <span className={`audit-component-card__conf`}>
                                Conf: {(comp.confidence * 100).toFixed(1)}%
                            </span>
                        </div>
                        <div className="score-item" style={{ marginBottom: 0 }}>
                            <div className="score-item__header">
                                <span className="score-item__label" style={{ fontSize: 'var(--font-sm)' }}>
                                    Similarity Score
                                </span>
                                <span className={`score-item__value ${comp.similarity_score >= 70 ? 'good' : comp.similarity_score >= 50 ? 'medium' : 'bad'}`}>
                                    {comp.similarity_score}%
                                </span>
                            </div>
                            <div className="score-bar">
                                <div
                                    className={`score-bar__fill ${getScoreColor(comp.similarity_score)}`}
                                    style={{ width: `${comp.similarity_score}%` }}
                                />
                            </div>
                        </div>
                        <div className="audit-component-card__meta">
                            Matched: {comp.matched_expert}
                        </div>
                    </div>
                    )
                })}
            </div>

            {/* Actions */}
            <div className="footer-actions" style={{ marginTop: 'var(--space-8)', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                    className="btn btn-primary"
                    onClick={() => {
                        setResult(null)
                        setAuditStep('upload')
                        setPreviewUrl(null)
                        setSelectedFile(null)
                        setUploadProgress(0)
                        setUploadedFileName(null)
                        setUploadedFileSize(null)
                    }}
                >
                    Audit Another Screenshot
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={downloadPdfReport}
                    disabled={exportingPdf}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                    title="Download a PDF report containing every component's number and score"
                >
                    {exportingPdf ? (
                        <>
                            <svg
                                width="16" height="16" viewBox="0 0 24 24"
                                fill="none" stroke="currentColor" strokeWidth="2.5"
                                strokeLinecap="round" strokeLinejoin="round"
                                style={{ animation: 'spin 1s linear infinite' }}
                                aria-hidden
                            >
                                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                            </svg>
                            Generating PDF…
                        </>
                    ) : (
                        <>
                            <svg
                                width="16" height="16" viewBox="0 0 24 24"
                                fill="none" stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                aria-hidden
                            >
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download PDF Report
                        </>
                    )}
                </button>
                {onNext && (
                    <button
                        className="btn btn-primary btn-primary-lg shadow-glow"
                        onClick={() => onNext(result, previewUrl)}
                    >
                        Go to UI Enhancer →
                    </button>
                )}
            </div>
        </div>
    )
}

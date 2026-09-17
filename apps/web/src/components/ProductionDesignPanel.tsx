import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download,
  FileText,
  ImagePlus,
  MessageCircle,
  Pencil,
  Trash2,
  Upload,
  Wand2,
  X,
  ZoomIn,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'
import { apiFetch, apiFetchBlob, apiUpload } from '../lib/api'
import type { Order } from '../lib/orders'
import { STAGE_LABELS, STATUS_LABELS, orderTitle } from '../lib/orders'
import {
  CATALOG_GARMENT,
  COLOR_PRESETS,
  DEFAULT_GARMENT_VIEWS,
  PRODUCT_TYPE_OPTIONS,
  normalizeHex,
  presetLabel,
  resolveProductTypeFromText,
  templateKeyFor,
  type ProductType,
} from '../lib/garmentDefaults'

type Placement = { x: number; y: number; scale: number; rotation: number }

type Mockup = {
  id: string
  design_asset_id: string
  garment_type: string
  view: string
  placement: Placement
  engine: string
  status: string
  has_file: boolean
  created_at: string
  updated_at?: string
}

type DesignAsset = {
  id: string
  file_name: string
  mime_type: string
  byte_size: number
  kind: 'SOURCE' | 'DESIGN' | string
  view_type: string | null
  title: string | null
  created_at: string
  updated_at: string
  mockups: Mockup[]
}

type Template = {
  key: string
  garment_type: string
  view: string
  label: string
  width: number
  height: number
  print_area: { x: number; y: number; w: number; h: number }
}

type ViewTypeOpt = { value: string; label: string }

type GalleryItem =
  | {
      key: string
      source: 'design'
      asset: DesignAsset
      viewType: string
      label: string
      title: string
      updatedAt: string
      prominent: boolean
    }
  | {
      key: string
      source: 'mockup'
      mockup: Mockup
      viewType: string
      label: string
      title: string
      updatedAt: string
      prominent: boolean
    }
  | {
      key: string
      source: 'default'
      templateKey: string
      viewType: string
      label: string
      title: string
      updatedAt: string
      prominent: boolean
    }

const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.45, scale: 0.55, rotation: 0 }

const VIEW_LABELS: Record<string, string> = {
  FRONT: 'Front',
  BACK: 'Back',
  LEFT: 'Left',
  RIGHT: 'Right',
  LEFT_SLEEVE: 'Left Sleeve',
  RIGHT_SLEEVE: 'Right Sleeve',
  COLLAR: 'Collar',
  LOGO_ARTWORK: 'Logo / Artwork',
  FABRIC_TEXTURE: 'Fabric / Texture',
  DETAIL: 'Detail',
  OTHER: 'Other',
}

const PROMINENT = new Set(['FRONT', 'BACK', 'LEFT', 'RIGHT'])

function viewLabel(code: string | null | undefined): string {
  if (!code) return 'Other'
  return VIEW_LABELS[code] ?? code.replace(/_/g, ' ')
}

function useAuthBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await apiFetchBlob(path)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!cancelled) setUrl(null)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])
  return path ? url : null
}

function AuthThumb({ path, alt, style }: { path: string; alt: string; style?: CSSProperties }) {
  const url = useAuthBlobUrl(path)
  if (!url) {
    return (
      <div className="design-thumb-ph" style={style}>
        …
      </div>
    )
  }
  return <img src={url} alt={alt} className="design-thumb-img" style={style} />
}

function PlacementCanvas({
  template,
  templateSrc,
  designSrc,
  placement,
  onChange,
}: {
  template: Template
  templateSrc: string | null
  designSrc: string | null
  placement: Placement
  onChange: (p: Placement) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const placementRef = useRef(placement)
  const tmplImg = useRef<HTMLImageElement | null>(null)
  const designImg = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(0)

  placementRef.current = placement

  useEffect(() => {
    if (!templateSrc) {
      tmplImg.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      tmplImg.current = img
      setReady((n) => n + 1)
    }
    img.src = templateSrc
  }, [templateSrc])

  useEffect(() => {
    if (!designSrc) {
      designImg.current = null
      return
    }
    const img = new Image()
    img.onload = () => {
      designImg.current = img
      setReady((n) => n + 1)
    }
    img.src = designSrc
  }, [designSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = template.width
    const h = template.height
    canvas.width = w
    canvas.height = h
    ctx.clearRect(0, 0, w, h)
    if (tmplImg.current) ctx.drawImage(tmplImg.current, 0, 0, w, h)
    const area = template.print_area
    // API sends 0–1 fractions; tolerate legacy pixel values just in case.
    const frac =
      area.w > 1 || area.h > 1 || area.x > 1 || area.y > 1
        ? { x: area.x / w, y: area.y / h, w: area.w / w, h: area.h / h }
        : area
    const ax = frac.x * w
    const ay = frac.y * h
    const aw = frac.w * w
    const ah = frac.h * h
    ctx.strokeStyle = 'rgba(124,58,237,0.55)'
    ctx.setLineDash([6, 4])
    ctx.strokeRect(ax, ay, aw, ah)
    ctx.setLineDash([])
    if (designImg.current) {
      const img = designImg.current
      const scale = placement.scale
      const dw = aw * scale
      const dh = (img.height / img.width) * dw
      const cx = ax + aw * placement.x
      const cy = ay + ah * placement.y
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate((placement.rotation * Math.PI) / 180)
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    }
  }, [template, placement, ready])

  function pointerToPlacement(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const area = template.print_area
    const w = template.width
    const h = template.height
    const frac =
      area.w > 1 || area.h > 1 || area.x > 1 || area.y > 1
        ? { x: area.x / w, y: area.y / h, w: area.w / w, h: area.h / h }
        : area
    const px = Math.min(1, Math.max(0, (x - frac.x) / frac.w))
    const py = Math.min(1, Math.max(0, (y - frac.y) / frac.h))
    onChange({ ...placementRef.current, x: px, y: py })
  }

  return (
    <div className="design-placement-wrap">
      <canvas
        ref={canvasRef}
        className="design-placement-canvas"
        style={{ width: '100%', maxWidth: 360, height: 'auto', touchAction: 'none', cursor: 'grab' }}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          pointerToPlacement(e)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          pointerToPlacement(e)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onWheel={(e) => {
          e.preventDefault()
          const delta = e.deltaY > 0 ? -0.04 : 0.04
          const next = Math.min(1, Math.max(0.05, placementRef.current.scale + delta))
          onChange({ ...placementRef.current, scale: next })
        }}
      />
      <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
        Drag to move · scroll to resize
      </p>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

async function downloadPath(path: string, filename: string) {
  const blob = await apiFetchBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type ViewerState =
  | { kind: 'source'; asset: DesignAsset }
  | { kind: 'design'; asset: DesignAsset }
  | { kind: 'mockup'; mockup: Mockup; title: string; viewType: string }
  | { kind: 'default'; templateKey: string; viewType: string; title: string }
  | null

export function ProductionDesignPanel({
  orgId,
  orderId,
  orderNumber,
  leadPhone,
  canEdit,
  order,
}: {
  orgId: string
  orderId: string
  orderNumber: string
  leadPhone: string | null
  canEdit: boolean
  order?: Order | null
}) {
  const qc = useQueryClient()
  const basePath = `/v1/orgs/${orgId}/production/${orderId}`
  const customerFileRef = useRef<HTMLInputElement>(null)
  const designFileRef = useRef<HTMLInputElement>(null)
  const replaceFileRef = useRef<HTMLInputElement>(null)
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null)

  const [showAddView, setShowAddView] = useState(false)
  const [addViewType, setAddViewType] = useState('FRONT')
  const [addTitle, setAddTitle] = useState('')
  const [pendingDesignFile, setPendingDesignFile] = useState<File | null>(null)

  const [genSourceId, setGenSourceId] = useState<string | null>(null)
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT)
  const artworkFileRef = useRef<HTMLInputElement>(null)
  const [viewer, setViewer] = useState<ViewerState>(null)
  const [zoom, setZoom] = useState(1)

  const detectedType =
    resolveProductTypeFromText(order?.name, order?.display_name, order?.lead_title) ?? 'T_SHIRT'
  const [productType, setProductType] = useState<ProductType>(() => {
    const saved = order?.design_garment_type as ProductType | null | undefined
    if (saved && PRODUCT_TYPE_OPTIONS.some((o) => o.value === saved)) return saved
    return detectedType
  })
  const [templateKey, setTemplateKey] = useState(() => {
    const saved = order?.design_garment_type as ProductType | null | undefined
    const pt =
      saved && PRODUCT_TYPE_OPTIONS.some((o) => o.value === saved) ? saved : detectedType
    return templateKeyFor(pt, 'FRONT')
  })
  const [garmentColor, setGarmentColor] = useState(() =>
    normalizeHex(order?.design_garment_color, '#FFFFFF'),
  )
  const prefsSeeded = useRef(false)

  const designsQ = useQuery({
    queryKey: ['production-designs', orgId, orderId],
    queryFn: () => apiFetch<{ items: DesignAsset[] }>(`${basePath}/designs`),
  })
  const viewTypesQ = useQuery({
    queryKey: ['design-view-types', orgId, orderId],
    queryFn: () => apiFetch<{ items: ViewTypeOpt[] }>(`${basePath}/design-view-types`),
  })
  const templatesQ = useQuery({
    queryKey: ['mockup-templates', orgId, orderId],
    queryFn: () => apiFetch<{ items: Template[] }>(`${basePath}/mockup-templates`),
  })

  const designs = useMemo(() => designsQ.data?.items ?? [], [designsQ.data?.items])
  const viewTypes = viewTypesQ.data?.items ?? Object.entries(VIEW_LABELS).map(([value, label]) => ({ value, label }))
  const templates = useMemo(() => templatesQ.data?.items ?? [], [templatesQ.data?.items])
  const customerFiles = useMemo(
    () => designs.filter((d) => (d.kind || 'SOURCE') !== 'DESIGN'),
    [designs],
  )
  const designViews = useMemo(() => designs.filter((d) => d.kind === 'DESIGN'), [designs])
  /** Any uploaded image can be placed onto a garment template (old Design flow). */
  const artworkImages = useMemo(
    () => designs.filter((d) => d.mime_type.startsWith('image/')),
    [designs],
  )

  const coveredViews = useMemo(() => {
    const set = new Set<string>()
    for (const d of designViews) {
      if (d.view_type) set.add(d.view_type)
    }
    for (const d of designs) {
      for (const m of d.mockups) {
        if (!m.has_file) continue
        const vt = m.view?.toUpperCase()
        if (vt === 'FRONT' || vt === 'BACK' || vt === 'LEFT' || vt === 'RIGHT') set.add(vt)
      }
    }
    return set
  }, [designViews, designs])

  const gallery: GalleryItem[] = useMemo(() => {
    const items: GalleryItem[] = []
    for (const d of designViews) {
      const vt = d.view_type || 'OTHER'
      items.push({
        key: `d-${d.id}`,
        source: 'design',
        asset: d,
        viewType: vt,
        label: viewLabel(vt),
        title: d.title?.trim() || d.file_name,
        updatedAt: d.updated_at || d.created_at,
        prominent: PROMINENT.has(vt),
      })
    }
    for (const d of designs) {
      for (const m of d.mockups) {
        if (!m.has_file) continue
        const raw = m.view?.toUpperCase() || 'OTHER'
        const vt =
          raw === 'BACK' || raw === 'FRONT' || raw === 'LEFT' || raw === 'RIGHT' ? raw : 'OTHER'
        items.push({
          key: `m-${m.id}`,
          source: 'mockup',
          mockup: m,
          viewType: vt,
          label: viewLabel(vt),
          title: `${m.garment_type.replace(/_/g, ' ')} · ${viewLabel(vt)}`,
          updatedAt: m.updated_at || m.created_at,
          prominent: PROMINENT.has(vt),
        })
      }
    }
    for (const view of DEFAULT_GARMENT_VIEWS) {
      if (coveredViews.has(view)) continue
      const tk = templateKeyFor(productType, view)
      items.push({
        key: `default-${view}`,
        source: 'default',
        templateKey: tk,
        viewType: view,
        label: viewLabel(view),
        title: `${PRODUCT_TYPE_OPTIONS.find((o) => o.value === productType)?.label ?? 'Garment'} · ${viewLabel(view)}`,
        updatedAt: '',
        prominent: view === 'FRONT' || view === 'BACK',
      })
    }
    const rank = (vt: string) =>
      vt === 'FRONT' ? 0 : vt === 'BACK' ? 1 : vt === 'LEFT' ? 2 : vt === 'RIGHT' ? 3 : 4
    items.sort((a, b) => rank(a.viewType) - rank(b.viewType) || a.label.localeCompare(b.label))
    return items
  }, [designViews, designs, coveredViews, productType])

  const savePrefs = useMutation({
    mutationFn: (p: { design_garment_type?: string; design_garment_color?: string }) =>
      apiFetch(`/v1/orgs/${orgId}/production/${orderId}`, {
        method: 'PATCH',
        json: p,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['production', orgId] })
    },
    onError: (err: Error) => toast.error(err.message || 'Could not save design prefs'),
  })

  // Persist auto-detected type once when order has no saved preference.
  useEffect(() => {
    if (!order || !canEdit || prefsSeeded.current) return
    prefsSeeded.current = true
    if (!order.design_garment_type) {
      savePrefs.mutate({
        design_garment_type: productType,
        design_garment_color: garmentColor,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per order open
  }, [order?.id])

  const activeTemplate = templates.find((t) => t.key === templateKey) ?? templates[0] ?? null
  const genSource = artworkImages.find((d) => d.id === genSourceId) ?? artworkImages[0] ?? null

  const templateUrl = useAuthBlobUrl(
    activeTemplate
      ? `${basePath}/default-mockups/${activeTemplate.key}?color=${encodeURIComponent(garmentColor)}`
      : null,
  )
  const genDesignUrl = useAuthBlobUrl(
    genSource ? `${basePath}/designs/${genSource.id}/file` : null,
  )
  const viewerPath =
    viewer?.kind === 'mockup'
      ? `${basePath}/mockups/${viewer.mockup.id}/file`
      : viewer?.kind === 'default'
        ? `${basePath}/default-mockups/${viewer.templateKey}?color=${encodeURIComponent(garmentColor)}`
        : viewer && (viewer.kind === 'source' || viewer.kind === 'design')
          ? `${basePath}/designs/${viewer.asset.id}/file`
          : null
  const viewerUrl = useAuthBlobUrl(viewerPath)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['production-designs', orgId, orderId] })
  }

  const doUploadArtwork = useMutation({
    mutationFn: (file: File) => apiUpload<DesignAsset>(`${basePath}/designs`, file, { kind: 'SOURCE' }),
    onSuccess: (asset) => {
      toast.success('Design uploaded — place it on a garment and generate')
      setGenSourceId(asset.id)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Upload failed'),
  })

  const doUploadCustomer = useMutation({
    mutationFn: (file: File) => apiUpload<DesignAsset>(`${basePath}/designs`, file, { kind: 'SOURCE' }),
    onSuccess: () => {
      toast.success('Customer file uploaded')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Upload failed'),
  })

  const doUploadDesign = useMutation({
    mutationFn: ({ file, viewType, title }: { file: File; viewType: string; title: string }) =>
      apiUpload<DesignAsset>(`${basePath}/designs`, file, {
        kind: 'DESIGN',
        view_type: viewType,
        ...(title.trim() ? { title: title.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('View image added')
      setShowAddView(false)
      setPendingDesignFile(null)
      setAddTitle('')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Upload failed'),
  })

  const replaceFile = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      apiUpload<DesignAsset>(`${basePath}/designs/${id}/replace`, file),
    onSuccess: () => {
      toast.success('File replaced')
      setReplaceTargetId(null)
      invalidate()
      setViewer(null)
    },
    onError: (err: Error) => toast.error(err.message || 'Replace failed'),
  })

  const removeDesign = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${basePath}/designs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Removed')
      setViewer(null)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Delete failed'),
  })

  const removeMockup = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${basePath}/mockups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Mockup removed')
      setViewer(null)
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Delete failed'),
  })

  const generate = useMutation({
    mutationFn: () => {
      if (!genSource || !activeTemplate) throw new Error('Pick artwork and a garment template')
      return apiFetch<Mockup>(`${basePath}/mockups`, {
        method: 'POST',
        json: {
          design_asset_id: genSource.id,
          garment_type: activeTemplate.garment_type,
          view: activeTemplate.view,
          placement,
          engine: 'TEMPLATE_2D',
          garment_color: garmentColor,
        },
      })
    },
    onSuccess: () => {
      toast.success('Mockup generated')
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message || 'Generate failed'),
  })

  const shareWhatsApp = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ sent: boolean }>(`${basePath}/mockups/${id}/send-whatsapp`, {
        method: 'POST',
        json: { caption: `Mockup preview for order ${orderNumber}` },
      }),
    onSuccess: () => toast.success('Mockup sent on WhatsApp'),
    onError: (err: Error) => toast.error(err.message || 'WhatsApp send failed'),
  })

  const delivery =
    order?.expected_dispatch_at || order?.expected_completion_at
      ? formatDate(order.expected_dispatch_at || order.expected_completion_at || '')
      : '—'

  return (
    <div className="design-workspace">
      {/* Order context */}
      <header className="design-context">
        <div>
          <p className="design-context-kicker">Design</p>
          <h2 className="design-context-title">{order ? orderTitle(order) : orderNumber}</h2>
        </div>
        <dl className="design-context-meta">
          <div>
            <dt>Customer</dt>
            <dd>{order?.lead_title || '—'}</dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd className="mono">{orderNumber}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{delivery}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {order
                ? `${STAGE_LABELS[order.stage] ?? order.stage} · ${STATUS_LABELS[order.order_status] ?? order.order_status}`
                : '—'}
            </dd>
          </div>
        </dl>
      </header>

      {/* Customer files */}
      <section className="design-section">
        <div className="design-section-head">
          <div>
            <h3>Customer files & tech packs</h3>
            <p className="muted small">Source material from the customer — PDFs, artwork, references.</p>
          </div>
          {canEdit && (
            <>
              <input
                ref={customerFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) doUploadCustomer.mutate(f)
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={doUploadCustomer.isPending}
                onClick={() => customerFileRef.current?.click()}
              >
                <Upload size={14} />
                {doUploadCustomer.isPending ? 'Uploading…' : 'Upload file'}
              </button>
            </>
          )}
        </div>

        {customerFiles.length === 0 ? (
          <div className="design-empty">
            <p>No customer files uploaded yet.</p>
            {canEdit && (
              <button type="button" className="btn btn-sm" onClick={() => customerFileRef.current?.click()}>
                <Upload size={14} />
                Upload file
              </button>
            )}
          </div>
        ) : (
          <div className="design-file-grid">
            {customerFiles.map((f) => {
              const isPdf = f.mime_type === 'application/pdf'
              const isImage = f.mime_type.startsWith('image/')
              return (
                <article key={f.id} className="design-file-card">
                  <button
                    type="button"
                    className="design-file-preview"
                    onClick={() => {
                      setZoom(1)
                      setViewer({ kind: 'source', asset: f })
                    }}
                  >
                    {isImage ? (
                      <AuthThumb
                        path={`${basePath}/designs/${f.id}/file`}
                        alt={f.file_name}
                        style={{ width: '100%', height: '100%' }}
                      />
                    ) : (
                      <div className="design-file-pdf">
                        <FileText size={28} />
                        <span>PDF</span>
                      </div>
                    )}
                  </button>
                  <div className="design-file-info">
                    <strong title={f.file_name}>{f.file_name}</strong>
                    <span className="muted small">
                      {isPdf ? 'PDF' : f.mime_type.split('/')[1]?.toUpperCase() || 'File'} ·{' '}
                      {formatBytes(f.byte_size)} · {formatDate(f.created_at)}
                    </span>
                    <div className="design-file-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setZoom(1)
                          setViewer({ kind: 'source', asset: f })
                        }}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void downloadPath(`${basePath}/designs/${f.id}/file`, f.file_name).catch((err) =>
                            toast.error(err instanceof Error ? err.message : 'Download failed'),
                          )
                        }
                      >
                        <Download size={13} />
                      </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setReplaceTargetId(f.id)
                              replaceFileRef.current?.click()
                            }}
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              if (confirm(`Delete “${f.file_name}”?`)) removeDesign.mutate(f.id)
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Designs & mockups — artwork → garment template → generate */}
      <section className="design-section">
        <div className="design-section-head">
          <div>
            <h3>Designs & mockups</h3>
            <p className="muted small">
              Upload artwork, place it on a garment (T-Shirt, Polo, etc.), and generate Front/Back mockups.
            </p>
          </div>
          <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            {canEdit && (
              <>
                <input
                  ref={artworkFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) doUploadArtwork.mutate(f)
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={doUploadArtwork.isPending}
                  onClick={() => artworkFileRef.current?.click()}
                >
                  <ImagePlus size={14} />
                  {doUploadArtwork.isPending ? 'Uploading…' : 'Add design'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => {
                    setAddViewType('FRONT')
                    setShowAddView(true)
                  }}
                >
                  Add finished view
                </button>
              </>
            )}
          </div>
        </div>

        <div className="design-garment-controls">
          <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
            <label className="input-label">Product type</label>
            <select
              className="select"
              value={productType}
              disabled={!canEdit}
              onChange={(e) => {
                const next = e.target.value as ProductType
                setProductType(next)
                const preferred = templateKeyFor(next, 'FRONT')
                if (templates.some((t) => t.key === preferred)) {
                  setTemplateKey(preferred)
                  setPlacement(DEFAULT_PLACEMENT)
                }
                if (canEdit) savePrefs.mutate({ design_garment_type: next })
              }}
            >
              {PRODUCT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0 }}>
            <label className="input-label">Colour</label>
            <div className="design-color-row">
              <span
                className="design-color-swatch"
                style={{ background: garmentColor }}
                title={presetLabel(garmentColor) ?? garmentColor}
              />
              <select
                className="select"
                value={COLOR_PRESETS.some((c) => c.hex.toUpperCase() === garmentColor) ? garmentColor : 'custom'}
                disabled={!canEdit}
                onChange={(e) => {
                  if (e.target.value === 'custom') return
                  const next = normalizeHex(e.target.value)
                  setGarmentColor(next)
                  if (canEdit) savePrefs.mutate({ design_garment_color: next })
                }}
              >
                {COLOR_PRESETS.map((c) => (
                  <option key={c.hex} value={c.hex}>
                    {c.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input
                type="color"
                className="design-color-input"
                value={garmentColor}
                disabled={!canEdit}
                title="Custom colour"
                onChange={(e) => {
                  const next = normalizeHex(e.target.value)
                  setGarmentColor(next)
                  if (canEdit) savePrefs.mutate({ design_garment_color: next })
                }}
              />
              <span className="muted small mono">{garmentColor}</span>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="design-generator card">
            <p className="muted small" style={{ marginTop: 0 }}>
              Place your design on a garment template, then generate a Front or Back mockup.
            </p>
            {!artworkImages.length ? (
              <div className="design-empty" style={{ padding: '0.75rem 0' }}>
                <p>No design artwork yet. Upload a logo or print design to place on a garment.</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={doUploadArtwork.isPending}
                  onClick={() => artworkFileRef.current?.click()}
                >
                  <ImagePlus size={14} />
                  Add design
                </button>
              </div>
            ) : (
              <div className="row" style={{ gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {activeTemplate && (
                  <PlacementCanvas
                    template={activeTemplate}
                    templateSrc={templateUrl}
                    designSrc={genDesignUrl}
                    placement={placement}
                    onChange={setPlacement}
                  />
                )}
                <div className="stack" style={{ gap: '0.6rem', minWidth: 200, flex: 1 }}>
                  <div className="form-field" style={{ margin: 0 }}>
                    <label className="input-label">Artwork</label>
                    <select
                      className="select"
                      value={genSource?.id ?? ''}
                      onChange={(e) => setGenSourceId(e.target.value)}
                    >
                      {artworkImages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.file_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field" style={{ margin: 0 }}>
                    <label className="input-label">Garment template</label>
                    <select
                      className="select"
                      value={activeTemplate?.key ?? ''}
                      onChange={(e) => {
                        setTemplateKey(e.target.value)
                        setPlacement(DEFAULT_PLACEMENT)
                      }}
                    >
                      {[
                        ...templates.filter((t) => t.garment_type === CATALOG_GARMENT[productType]),
                        ...templates.filter((t) => t.garment_type !== CATALOG_GARMENT[productType]),
                      ].map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field" style={{ margin: 0 }}>
                    <label className="input-label">Scale ({Math.round(placement.scale * 100)}%)</label>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.01}
                      value={placement.scale}
                      onChange={(e) => setPlacement({ ...placement, scale: Number(e.target.value) })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={generate.isPending || !genSource || !activeTemplate}
                    onClick={() => generate.mutate()}
                  >
                    <Wand2 size={14} />
                    {generate.isPending ? 'Generating…' : 'Generate mockup'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="design-gallery">
          {gallery.map((item) => {
            const path =
              item.source === 'design'
                ? `${basePath}/designs/${item.asset.id}/file`
                : item.source === 'mockup'
                  ? `${basePath}/mockups/${item.mockup.id}/file`
                  : `${basePath}/default-mockups/${item.templateKey}?color=${encodeURIComponent(garmentColor)}`
            return (
              <button
                key={item.key}
                type="button"
                className={`design-gallery-card${item.prominent ? ' design-gallery-card--hero' : ''}`}
                onClick={() => {
                  setZoom(1)
                  if (item.source === 'design') setViewer({ kind: 'design', asset: item.asset })
                  else if (item.source === 'mockup')
                    setViewer({
                      kind: 'mockup',
                      mockup: item.mockup,
                      title: item.title,
                      viewType: item.viewType,
                    })
                  else
                    setViewer({
                      kind: 'default',
                      templateKey: item.templateKey,
                      viewType: item.viewType,
                      title: item.title,
                    })
                }}
              >
                <div className="design-gallery-media">
                  <AuthThumb path={path} alt={item.title} style={{ width: '100%', height: '100%' }} />
                </div>
                <div className="design-gallery-caption">
                  <span className="design-view-badge">{item.label}</span>
                  <strong>{item.title}</strong>
                  {item.source === 'default' && (
                    <span className="muted small">Default mockup</span>
                  )}
                  {item.source === 'mockup' && (
                    <span className="muted small">Generated mockup</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Add finished view dialog */}
      {showAddView && (
        <div className="design-dialog-backdrop" role="presentation" onClick={() => setShowAddView(false)}>
          <div
            className="design-dialog"
            role="dialog"
            aria-label="Add finished view"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row spread" style={{ alignItems: 'center' }}>
              <strong>Add finished view</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddView(false)}>
                <X size={14} />
              </button>
            </div>
            <p className="muted small">
              Upload an already-finished Front/Back image. To place artwork on a T-Shirt/Polo, use Add design
              instead.
            </p>
            <div className="form-field">
              <label className="input-label">View type</label>
              <select className="select" value={addViewType} onChange={(e) => setAddViewType(e.target.value)}>
                {viewTypes.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="input-label">Title (optional)</label>
              <input
                className="input"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="e.g. Front — navy polo"
              />
            </div>
            <div className="form-field">
              <label className="input-label">Image</label>
              <input
                ref={designFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setPendingDesignFile(e.target.files?.[0] ?? null)}
              />
              {pendingDesignFile && (
                <span className="muted small">{pendingDesignFile.name}</span>
              )}
            </div>
            <button
              type="button"
              className="btn"
              disabled={!pendingDesignFile || doUploadDesign.isPending}
              onClick={() => {
                if (!pendingDesignFile) return
                doUploadDesign.mutate({
                  file: pendingDesignFile,
                  viewType: addViewType,
                  title: addTitle,
                })
              }}
            >
              {doUploadDesign.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <input
        ref={replaceFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f && replaceTargetId) replaceFile.mutate({ id: replaceTargetId, file: f })
        }}
      />

      {/* Full-screen viewer */}
      {viewer && (
        <div className="design-viewer">
          <header className="design-viewer-bar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setViewer(null)
                setZoom(1)
              }}
            >
              ← Design
            </button>
            <div className="design-viewer-title">
              <strong>
                {viewer.kind === 'mockup' || viewer.kind === 'default'
                  ? viewer.title
                  : viewer.asset.title?.trim() || viewer.asset.file_name}
              </strong>
              <span className="muted small">
                {viewer.kind === 'mockup'
                  ? viewLabel(viewer.viewType)
                  : viewer.kind === 'default'
                    ? `${viewLabel(viewer.viewType)} · Default mockup`
                    : viewer.kind === 'design'
                      ? viewLabel(viewer.asset.view_type)
                      : viewer.asset.mime_type === 'application/pdf'
                        ? 'Customer PDF'
                        : 'Customer file'}
              </span>
            </div>
            <div className="design-viewer-actions">
              {(viewer.kind === 'design' ||
                viewer.kind === 'mockup' ||
                viewer.kind === 'default' ||
                (viewer.kind === 'source' && viewer.asset.mime_type.startsWith('image/'))) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setZoom((z) => (z >= 2 ? 1 : z + 0.5))}
                  title="Zoom"
                >
                  <ZoomIn size={14} />
                  {zoom > 1 ? `${zoom}×` : 'Zoom'}
                </button>
              )}
              {viewer.kind === 'default' && canEdit && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setAddViewType(viewer.viewType)
                    setShowAddView(true)
                    setViewer(null)
                  }}
                >
                  <ImagePlus size={14} />
                  Add {viewLabel(viewer.viewType)} design
                </button>
              )}
              {viewer.kind !== 'default' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const path =
                      viewer.kind === 'mockup'
                        ? `${basePath}/mockups/${viewer.mockup.id}/file`
                        : `${basePath}/designs/${viewer.asset.id}/file`
                    const name =
                      viewer.kind === 'mockup'
                        ? `mockup-${viewer.mockup.view}.png`
                        : viewer.asset.file_name
                    void downloadPath(path, name).catch((err) =>
                      toast.error(err instanceof Error ? err.message : 'Download failed'),
                    )
                  }}
                >
                  <Download size={14} />
                  Download
                </button>
              )}
              {canEdit && viewer.kind !== 'mockup' && viewer.kind !== 'default' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setReplaceTargetId(viewer.asset.id)
                    replaceFileRef.current?.click()
                  }}
                >
                  <Pencil size={14} />
                  Replace
                </button>
              )}
              {canEdit && viewer.kind === 'mockup' && viewer.mockup.has_file && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={shareWhatsApp.isPending || !leadPhone}
                  onClick={() => shareWhatsApp.mutate(viewer.mockup.id)}
                >
                  <MessageCircle size={14} />
                  WhatsApp
                </button>
              )}
              {canEdit && viewer.kind !== 'default' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (viewer.kind === 'mockup') {
                      if (confirm('Delete this mockup?')) removeMockup.mutate(viewer.mockup.id)
                    } else if (confirm(`Delete “${viewer.asset.file_name}”?`)) {
                      removeDesign.mutate(viewer.asset.id)
                    }
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>
          </header>
          <div className="design-viewer-stage">
            {viewer.kind === 'source' && viewer.asset.mime_type === 'application/pdf' ? (
              viewerUrl ? (
                <iframe title="PDF" src={viewerUrl} className="design-viewer-pdf" />
              ) : (
                <p className="muted">Loading PDF…</p>
              )
            ) : viewerUrl ? (
              <img
                src={viewerUrl}
                alt="Design"
                className="design-viewer-img"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <p className="muted">Loading…</p>
            )}
          </div>
          <footer className="design-viewer-meta">
            {viewer.kind === 'default' && (
              <span className="muted">Blank LoomRun garment visualization — not a customer upload</span>
            )}
            {(viewer.kind === 'design' || viewer.kind === 'source') && (
              <>
                <span>{viewer.asset.file_name}</span>
                <span className="muted">{formatBytes(viewer.asset.byte_size)}</span>
                <span className="muted">Updated {formatDate(viewer.asset.updated_at)}</span>
              </>
            )}
            {viewer.kind === 'mockup' && (
              <span className="muted">Updated {formatDate(viewer.mockup.updated_at || viewer.mockup.created_at)}</span>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}

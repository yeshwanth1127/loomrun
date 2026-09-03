import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Eye, FileText, Save, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { toast } from 'sonner'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type DocType = 'QUOTATION' | 'INVOICE'

type SectionConfig = {
  type: string
  enabled: boolean
  [key: string]: unknown
}

type TemplateLayout = {
  page: { size: 'letter' | 'A4'; margin: number }
  theme: {
    primaryColor: string
    accentColor: string
    fontFamily: 'Helvetica' | 'Times-Roman' | 'Courier'
    currencySymbol: string
  }
  sections: SectionConfig[]
}

type DocumentTemplate = {
  id: string
  organization_id: string | null
  name: string
  slug: string
  doc_type: DocType
  is_default: boolean
  is_system: boolean
  layout: TemplateLayout
  updated_at?: string
}

const SECTION_LABELS: Record<string, string> = {
  header: 'Header',
  doc_title: 'Document title',
  meta: 'Document meta',
  bill_to: 'Bill to',
  line_items: 'Line items',
  totals: 'Totals',
  payment: 'Payment',
  terms: 'Terms',
  signature: 'Signature',
  footer: 'Footer',
}

const LINE_COLUMNS = ['sl', 'description', 'qty', 'unit_price', 'line_total', 'sku', 'hsn'] as const

const DEFAULT_THEME: TemplateLayout['theme'] = {
  primaryColor: '#111827',
  accentColor: '#374151',
  fontFamily: 'Helvetica',
  currencySymbol: '₹',
}

function normalizeLayout(layout: TemplateLayout | Record<string, unknown>): TemplateLayout {
  const raw = layout as Record<string, unknown>
  const page = (raw.page as Record<string, unknown> | undefined) ?? {}
  const theme = (raw.theme as Record<string, unknown> | undefined) ?? {}
  return {
    page: {
      size: (page.size as TemplateLayout['page']['size']) ?? 'letter',
      margin: typeof page.margin === 'number' ? page.margin : 40,
    },
    theme: {
      primaryColor: String(theme.primaryColor ?? theme.primary_color ?? DEFAULT_THEME.primaryColor),
      accentColor: String(theme.accentColor ?? theme.accent_color ?? DEFAULT_THEME.accentColor),
      fontFamily: (theme.fontFamily ?? theme.font_family ?? DEFAULT_THEME.fontFamily) as TemplateLayout['theme']['fontFamily'],
      currencySymbol: String(theme.currencySymbol ?? theme.currency_symbol ?? DEFAULT_THEME.currencySymbol),
    },
    sections: Array.isArray(raw.sections) ? (raw.sections as SectionConfig[]) : [],
  }
}

function cloneLayout(layout: TemplateLayout | Record<string, unknown>): TemplateLayout {
  return normalizeLayout(JSON.parse(JSON.stringify(layout)) as TemplateLayout)
}

function storageKey(orgId: string, suffix: string) {
  return `lr:docTemplates:${orgId}:${suffix}`
}

export function DocumentTemplatesPage() {
  const { orgId, me } = useAuth()
  const qc = useQueryClient()
  const membership = me?.organizations.find((o) => o.organization.id === orgId)
  const isOwner = membership?.role === 'OWNER'

  const [docType, setDocType] = useState<DocType>('QUOTATION')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftLayout, setDraftLayout] = useState<TemplateLayout | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneSlug, setCloneSlug] = useState('')
  const [cloneSourceId, setCloneSourceId] = useState('')
  const previewUrlRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const lastHydratedRef = useRef<string | null>(null)

  const listQ = useQuery({
    queryKey: ['document-templates', orgId, docType],
    enabled: !!orgId,
    queryFn: () =>
      apiFetch<{
        items: DocumentTemplate[]
        system_defaults: DocumentTemplate[]
        default_quotation_template_id: string | null
        default_invoice_template_id: string | null
      }>(`/v1/orgs/${orgId}/document-templates?doc_type=${docType}`),
  })

  const templates = useMemo(() => {
    const orgItems = listQ.data?.items.filter((t) => t.doc_type === docType) ?? []
    return orgItems
  }, [listQ.data, docType])

  const systemDefaults = listQ.data?.system_defaults ?? []
  const defaultId =
    docType === 'QUOTATION'
      ? listQ.data?.default_quotation_template_id
      : listQ.data?.default_invoice_template_id

  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? templates[0]

  useEffect(() => {
    if (!orgId) return
    const storedDocType = localStorage.getItem(storageKey(orgId, 'docType'))
    const storedSelectedId = localStorage.getItem(storageKey(orgId, 'selectedId'))
    setDocType(storedDocType === 'INVOICE' ? 'INVOICE' : 'QUOTATION')
    setSelectedId(storedSelectedId && storedSelectedId !== 'null' ? storedSelectedId : null)
    dirtyRef.current = false
    lastHydratedRef.current = null
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    localStorage.setItem(storageKey(orgId, 'docType'), docType)
  }, [orgId, docType])

  useEffect(() => {
    if (!orgId) return
    localStorage.setItem(storageKey(orgId, 'selectedId'), selectedId ?? 'null')
  }, [orgId, selectedId])

  const previewMut = useMutation({
    mutationFn: async ({ layout, previewDocType }: { layout: TemplateLayout; previewDocType: DocType }) => {
      const res = await fetch(`${base}/v1/orgs/${orgId}/document-templates/preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ layout, doc_type: previewDocType }),
      })
      if (!res.ok) throw new Error('Preview failed')
      return res.blob()
    },
    onSuccess: (blob) => {
      const next = URL.createObjectURL(blob)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = next
      setPreviewUrl(next)
    },
  })

  function runPreview(layout: TemplateLayout, previewDocType: DocType = docType) {
    if (!orgId) return
    previewMut.mutate({ layout, previewDocType })
  }

  useEffect(() => {
    if (selectedTemplate && selectedId !== selectedTemplate.id) {
      setSelectedId(selectedTemplate.id)
    }
  }, [selectedTemplate, selectedId])

  useEffect(() => {
    if (!selectedTemplate || !orgId) return
    const hydrateKey = `${selectedTemplate.id}:${selectedTemplate.updated_at ?? ''}`
    if (lastHydratedRef.current === hydrateKey) return
    setDraftName(selectedTemplate.name)
    const layout = cloneLayout(selectedTemplate.layout)
    setDraftLayout(layout)
    dirtyRef.current = false
    lastHydratedRef.current = hydrateKey
    runPreview(layout, docType)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id, selectedTemplate?.updated_at, docType, orgId])

  useEffect(() => {
    if (!templates.length) return
    if (selectedId && templates.some((t) => t.id === selectedId)) return
    const fallbackId =
      defaultId && templates.some((t) => t.id === defaultId) ? defaultId : templates[0]?.id ?? null
    if (fallbackId && fallbackId !== selectedId) setSelectedId(fallbackId)
  }, [templates, selectedId, defaultId])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const saveMut = useMutation({
    mutationFn: (payload: { templateId: string; name: string; layout: TemplateLayout }) =>
      apiFetch<DocumentTemplate>(`/v1/orgs/${orgId}/document-templates/${payload.templateId}`, {
        method: 'PATCH',
        json: { name: payload.name, layout: payload.layout },
      }),
    onSuccess: (updated) => {
      toast.success('Template saved')
      const layout = cloneLayout(updated.layout)
      setDraftName(updated.name)
      setDraftLayout(layout)
      dirtyRef.current = false
      lastHydratedRef.current = `${updated.id}:${updated.updated_at ?? ''}`
      qc.setQueryData(
        ['document-templates', orgId, docType],
        (prev: { items: DocumentTemplate[]; system_defaults: DocumentTemplate[]; default_quotation_template_id: string | null; default_invoice_template_id: string | null } | undefined) => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.map((t) => (t.id === updated.id ? updated : t)),
          }
        },
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const setDefaultMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/document-templates/${id}/set-default`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Default template updated')
      void qc.invalidateQueries({ queryKey: ['document-templates', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const cloneMut = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/orgs/${orgId}/document-templates/clone`, {
        method: 'POST',
        json: {
          source_template_id: cloneSourceId,
          name: cloneName,
          slug: cloneSlug,
        },
      }),
    onSuccess: () => {
      toast.success('Template cloned')
      setCloneName('')
      setCloneSlug('')
      setCloneSourceId('')
      void qc.invalidateQueries({ queryKey: ['document-templates', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/orgs/${orgId}/document-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Template deleted')
      setSelectedId(null)
      void qc.invalidateQueries({ queryKey: ['document-templates', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function markDirty() {
    dirtyRef.current = true
  }

  function updateSection(index: number, patch: Partial<SectionConfig>) {
    if (!draftLayout) return
    markDirty()
    const sections = draftLayout.sections.map((s, i) => (i === index ? { ...s, ...patch } : s))
    setDraftLayout({ ...draftLayout, sections })
  }

  function moveSection(index: number, dir: -1 | 1) {
    if (!draftLayout) return
    markDirty()
    const next = index + dir
    if (next < 0 || next >= draftLayout.sections.length) return
    const sections = [...draftLayout.sections]
    ;[sections[index], sections[next]] = [sections[next], sections[index]]
    setDraftLayout({ ...draftLayout, sections })
  }

  if (!orgId) {
    return (
      <PageHeader title="Document templates" description="Select an organization." />
    )
  }

  return (
    <>
      <PageHeader title="Document templates" description="Customize quotation and invoice PDF layouts for your organization.">
        <div className="panel-tabs">
          {(['QUOTATION', 'INVOICE'] as DocType[]).map((dt) => (
            <button
              key={dt}
              type="button"
              className={`panel-tab${docType === dt ? ' active' : ''}`}
              onClick={() => {
                setDocType(dt)
                setSelectedId(null)
              }}
            >
              <FileText size={14} />
              {dt === 'QUOTATION' ? 'Quotations' : 'Invoices'}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="page-body stack" style={{ gap: '1.25rem' }}>
        {listQ.isLoading && <p className="muted">Loading templates…</p>}

        {isOwner && (
          <div className="card stack" style={{ gap: '0.75rem' }}>
            <div style={{ fontWeight: 700 }}>Clone from default</div>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                className="select"
                value={cloneSourceId}
                onChange={(e) => setCloneSourceId(e.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="">Select source…</option>
                {[...systemDefaults, ...templates].map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.is_system ? '(system)' : ''}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="New name"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
              />
              <input
                className="input"
                placeholder="slug-my-template"
                value={cloneSlug}
                onChange={(e) => setCloneSlug(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={!cloneSourceId || !cloneName || !cloneSlug || cloneMut.isPending}
                onClick={() => cloneMut.mutate()}
              >
                <Copy size={14} />
                Clone
              </button>
            </div>
          </div>
        )}

        <div className="row" style={{ gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="stack" style={{ flex: '1 1 340px', gap: '1rem', minWidth: 300 }}>
            <div className="card stack" style={{ gap: '0.5rem' }}>
              <div style={{ fontWeight: 700 }}>Your templates</div>
              {templates.length === 0 && <p className="muted small">No templates yet — clone a default above.</p>}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`btn btn-ghost ${selectedId === t.id ? 'active' : ''}`}
                  style={{ justifyContent: 'space-between', width: '100%' }}
                  onClick={() => {
                    dirtyRef.current = false
                    lastHydratedRef.current = null
                    setSelectedId(t.id)
                  }}
                >
                  <span>{t.name}</span>
                  {defaultId === t.id && (
                    <span className="badge badge-green" style={{ marginLeft: 8 }}>
                      Default
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selectedTemplate && draftLayout && (
              <>
                <div className="card stack" style={{ gap: '0.75rem' }}>
                  <input
                    className="input"
                    value={draftName}
                    onChange={(e) => {
                      markDirty()
                      setDraftName(e.target.value)
                    }}
                    disabled={!isOwner}
                  />
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    {isOwner && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={saveMut.isPending}
                          onClick={() => {
                            if (!draftLayout || !selectedTemplate?.id) return
                            saveMut.mutate({
                              templateId: selectedTemplate.id,
                              name: draftName,
                              layout: draftLayout,
                            })
                          }}
                        >
                          <Save size={14} />
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={setDefaultMut.isPending || defaultId === selectedTemplate.id}
                          onClick={() => setDefaultMut.mutate(selectedTemplate.id)}
                        >
                          <Star size={14} />
                          Set default
                        </button>
                        {!selectedTemplate.is_system && defaultId !== selectedTemplate.id && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={deleteMut.isPending}
                            onClick={() => deleteMut.mutate(selectedTemplate.id)}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="card stack" style={{ gap: '0.75rem' }}>
                  <div style={{ fontWeight: 700 }}>Theme</div>
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="input-label">Primary</span>
                      <input
                        type="color"
                        value={draftLayout.theme.primaryColor}
                        disabled={!isOwner}
                        onChange={(e) => {
                          markDirty()
                          setDraftLayout({
                            ...draftLayout,
                            theme: { ...draftLayout.theme, primaryColor: e.target.value },
                          })
                        }}
                      />
                    </label>
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="input-label">Currency</span>
                      <input
                        className="input"
                        style={{ width: 60 }}
                        value={draftLayout.theme.currencySymbol}
                        disabled={!isOwner}
                        onChange={(e) => {
                          markDirty()
                          setDraftLayout({
                            ...draftLayout,
                            theme: { ...draftLayout.theme, currencySymbol: e.target.value },
                          })
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="card stack" style={{ gap: '0.5rem' }}>
                  <div style={{ fontWeight: 700 }}>Sections</div>
                  {draftLayout.sections.map((section, index) => (
                    <div
                      key={`${section.type}-${index}`}
                      className="stack"
                      style={{
                        gap: '0.35rem',
                        padding: '0.5rem',
                        background: '#f8fafc',
                        borderRadius: 8,
                      }}
                    >
                      <div className="row spread" style={{ alignItems: 'center' }}>
                        <label className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={section.enabled}
                            disabled={!isOwner || section.type === 'line_items' || section.type === 'totals'}
                            onChange={(e) => updateSection(index, { enabled: e.target.checked })}
                          />
                          <span style={{ fontWeight: 600 }}>{SECTION_LABELS[section.type] ?? section.type}</span>
                        </label>
                        {isOwner && (
                          <div className="row" style={{ gap: 4 }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveSection(index, -1)}>
                              <ArrowUp size={12} />
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveSection(index, 1)}>
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setExpandedSection(expandedSection === section.type ? null : section.type)
                              }
                            >
                              Options
                            </button>
                          </div>
                        )}
                      </div>

                      {expandedSection === section.type && isOwner && (
                        <div className="stack" style={{ gap: '0.5rem', paddingTop: 4 }}>
                          {section.type === 'header' && (
                            <select
                              className="select"
                              value={String(section.layout ?? 'logo_left_company_right')}
                              onChange={(e) => updateSection(index, { layout: e.target.value })}
                            >
                              <option value="logo_left_company_right">Logo left, company right</option>
                              <option value="logo_center">Logo center</option>
                              <option value="company_only">Company only</option>
                              <option value="invoice_like">Invoice-like (title + logo + meta + bill to)</option>
                            </select>
                          )}
                          {section.type === 'line_items' && (
                            <div className="stack" style={{ gap: '0.5rem' }}>
                              <select
                                className="select"
                                value={String(section.style ?? 'plain')}
                                onChange={(e) => updateSection(index, { style: e.target.value })}
                              >
                                <option value="plain">Plain</option>
                                <option value="invoice_table">Invoice table (colored header)</option>
                              </select>
                              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                                {LINE_COLUMNS.map((col) => {
                                  const cols = (section.columns as string[]) ?? []
                                  return (
                                    <label key={col} className="row" style={{ gap: 4, fontSize: '0.85rem' }}>
                                      <input
                                        type="checkbox"
                                        checked={cols.includes(col)}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...cols, col]
                                            : cols.filter((c) => c !== col)
                                          updateSection(index, { columns: next })
                                        }}
                                      />
                                      {col}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {section.type === 'totals' && (
                            <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                              <label className="row" style={{ gap: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={!!section.showSubtotal}
                                  onChange={(e) => updateSection(index, { showSubtotal: e.target.checked })}
                                />
                                Subtotal
                              </label>
                              <label className="row" style={{ gap: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={!!section.showTax}
                                  onChange={(e) => updateSection(index, { showTax: e.target.checked })}
                                />
                                Tax
                              </label>
                            </div>
                          )}
                          {section.type === 'payment' && (
                            <>
                              <label className="row" style={{ gap: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={!!section.showUpiQr}
                                  onChange={(e) => updateSection(index, { showUpiQr: e.target.checked })}
                                />
                                Show UPI QR
                              </label>
                              <input
                                className="input"
                                placeholder="Payment note"
                                value={String(section.paymentNote ?? '')}
                                onChange={(e) => updateSection(index, { paymentNote: e.target.value })}
                              />
                            </>
                          )}
                          {(section.type === 'terms' || section.type === 'footer') && (
                            <textarea
                              className="input"
                              rows={3}
                              value={String(section.text ?? '')}
                              onChange={(e) => updateSection(index, { text: e.target.value })}
                              placeholder="Supports {{org.legal_name}}, {{quotation.total}}, etc."
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ flex: '1 1 420px', minWidth: 320, minHeight: 520 }}>
            <div className="row spread" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>Preview</div>
              {draftLayout && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={previewMut.isPending}
                  onClick={() => runPreview(draftLayout)}
                >
                  <Eye size={14} />
                  {previewMut.isPending ? 'Rendering…' : 'Update preview'}
                </button>
              )}
            </div>
            {previewMut.isPending && !previewUrl && <p className="muted small">Rendering preview…</p>}
            {previewUrl ? (
              <iframe
                title="Template preview"
                src={previewUrl}
                style={{ width: '100%', height: 480, border: '1px solid #e2e8f0', borderRadius: 8 }}
              />
            ) : (
              <p className="muted">Select a template to preview.</p>
            )}
          </div>
        </div>

        {!isOwner && (
          <p className="muted small">Only organization owners can edit templates. You can view layouts here.</p>
        )}
      </div>
    </>
  )
}

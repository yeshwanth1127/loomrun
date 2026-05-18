import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Palette, Shield, Trash2, Upload } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type CatalogItem = {
  id: string
  name: string
  description: string | null
  unit_price: number
  sku: string | null
  created_at: string
}

type BrandPayload = {
  legal_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  tax_id: string | null
  has_logo: boolean
  has_signature?: boolean
  has_upi_qr?: boolean
  updated_at: string
}

export function BrandAssetsPage() {
  const { orgId, me } = useAuth()
  const qc = useQueryClient()
  const membership = me?.organizations.find((o) => o.organization.id === orgId)
  const isOwner = membership?.role === 'OWNER'

  const [legalName, setLegalName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [taxId, setTaxId] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null)
  const [upiQrPreviewUrl, setUpiQrPreviewUrl] = useState<string | null>(null)

  const brandQ = useQuery({
    queryKey: ['org-brand', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<BrandPayload>(`/v1/orgs/${orgId}/brand`),
  })

  const catalogQ = useQuery({
    queryKey: ['catalog', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<{ items: CatalogItem[] }>(`/v1/orgs/${orgId}/catalog`),
  })

  useEffect(() => {
    const d = brandQ.data
    if (!d) return
    setLegalName(d.legal_name ?? '')
    setAddress(d.address ?? '')
    setPhone(d.phone ?? '')
    setEmail(d.email ?? '')
    setWebsite(d.website ?? '')
    setTaxId(d.tax_id ?? '')
  }, [brandQ.data])

  useEffect(() => {
    let revoke: string | null = null
    if (!orgId || !brandQ.data?.has_logo) {
      setPreviewUrl(null)
      return () => {}
    }
    const token = localStorage.getItem('access_token')
    ;(async () => {
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/logo`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) {
        setPreviewUrl(null)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      revoke = url
      setPreviewUrl(url)
    })().catch(() => setPreviewUrl(null))
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [orgId, brandQ.data?.has_logo, brandQ.data?.updated_at])

  useEffect(() => {
    let revoke: string | null = null
    if (!orgId || !brandQ.data?.has_signature) {
      setSignaturePreviewUrl(null)
      return () => {}
    }
    const token = localStorage.getItem('access_token')
    ;(async () => {
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/signature`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) {
        setSignaturePreviewUrl(null)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      revoke = url
      setSignaturePreviewUrl(url)
    })().catch(() => setSignaturePreviewUrl(null))
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [orgId, brandQ.data?.has_signature, brandQ.data?.updated_at])

  useEffect(() => {
    let revoke: string | null = null
    if (!orgId || !brandQ.data?.has_upi_qr) {
      setUpiQrPreviewUrl(null)
      return () => {}
    }
    const token = localStorage.getItem('access_token')
    ;(async () => {
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/upi-qr`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) {
        setUpiQrPreviewUrl(null)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      revoke = url
      setUpiQrPreviewUrl(url)
    })().catch(() => setUpiQrPreviewUrl(null))
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [orgId, brandQ.data?.has_upi_qr, brandQ.data?.updated_at])

  const save = useMutation({
    mutationFn: () =>
      apiFetch<BrandPayload>(`/v1/orgs/${orgId}/brand`, {
        method: 'PATCH',
        json: {
          legal_name: legalName.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          website: website.trim() || null,
          tax_id: taxId.trim() || null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const token = localStorage.getItem('access_token')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: unknown }
          msg = typeof j.detail === 'string' ? j.detail : text
        } catch {
          /* ignore */
        }
        throw new Error(msg || res.statusText)
      }
      return res.json() as Promise<{ updated_at: string }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const deleteLogo = useMutation({
    mutationFn: () =>
      apiFetch<{ updated_at: string }>(`/v1/orgs/${orgId}/brand/logo`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const uploadSignature = useMutation({
    mutationFn: async (file: File) => {
      const token = localStorage.getItem('access_token')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/signature`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: unknown }
          msg = typeof j.detail === 'string' ? j.detail : text
        } catch {
          /* ignore */
        }
        throw new Error(msg || res.statusText)
      }
      return res.json() as Promise<{ updated_at: string }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const deleteSignature = useMutation({
    mutationFn: () =>
      apiFetch<{ updated_at: string }>(`/v1/orgs/${orgId}/brand/signature`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const uploadUpiQr = useMutation({
    mutationFn: async (file: File) => {
      const token = localStorage.getItem('access_token')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${base}/v1/orgs/${orgId}/brand/upi-qr`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: unknown }
          msg = typeof j.detail === 'string' ? j.detail : text
        } catch {
          /* ignore */
        }
        throw new Error(msg || res.statusText)
      }
      return res.json() as Promise<{ updated_at: string }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const deleteUpiQr = useMutation({
    mutationFn: () =>
      apiFetch<{ updated_at: string }>(`/v1/orgs/${orgId}/brand/upi-qr`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['org-brand', orgId] })
    },
  })

  const uploadCatalog = useMutation({
    mutationFn: async (file: File) => {
      const token = localStorage.getItem('access_token')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${base}/v1/orgs/${orgId}/catalog/upload-csv`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try {
          const j = JSON.parse(text) as { detail?: unknown }
          msg = typeof j.detail === 'string' ? j.detail : text
        } catch {
          /* ignore */
        }
        throw new Error(msg || res.statusText)
      }
      return res.json() as Promise<{ items_created: number; errors: string[] }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog', orgId] })
    },
  })

  const deleteCatalogItem = useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/v1/orgs/${orgId}/catalog/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog', orgId] })
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  if (!orgId) {
    return (
      <>
        <div className="page-header">
          <h1>Brand assets</h1>
          <p>Select an organization.</p>
        </div>
      </>
    )
  }

  if (!isOwner) {
    return (
      <>
        <div className="page-header">
          <h1>Brand assets</h1>
          <p>Logo and business details used on quotations.</p>
        </div>
        <div className="page-body">
          <div className="card" style={{ maxWidth: 420 }}>
            <Shield size={24} style={{ color: '#94a3b8', marginBottom: '0.5rem' }} />
            <p>Only the organization owner can upload a logo and edit brand details.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1>Brand assets</h1>
        <p>
          Logo and contact details appear on{' '}
          <strong className="muted">generated quotation PDFs</strong> and in the sidebar for your team.
        </p>
      </div>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <div className="stack" style={{ gap: '1.25rem' }}>
          <div className="card stack">
            <div className="section-title row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <Palette size={18} />
              Logo
            </div>
            <div className="row" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f8fafc',
                  overflow: 'hidden',
                }}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span className="muted small">No logo</span>
                )}
              </div>
              <div className="stack" style={{ gap: '0.5rem' }}>
                <label className="btn btn-sm" style={{ cursor: uploadLogo.isPending ? 'wait' : 'pointer' }}>
                  <Upload size={14} />
                  Upload image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    disabled={uploadLogo.isPending}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadLogo.mutate(f)
                    }}
                  />
                </label>
                {brandQ.data?.has_logo && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={deleteLogo.isPending}
                    onClick={() => deleteLogo.mutate()}
                  >
                    <Trash2 size={14} />
                    Remove logo
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">PNG, JPEG, WebP, or GIF · max 2&nbsp;MB</p>
            {uploadLogo.isError && <p className="error small">{(uploadLogo.error as Error).message}</p>}
          </div>

          <div className="card stack">
            <div className="section-title row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <Palette size={18} />
              Signature
            </div>
            <div className="row" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f8fafc',
                  overflow: 'hidden',
                }}
              >
                {signaturePreviewUrl ? (
                  <img src={signaturePreviewUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span className="muted small">No signature</span>
                )}
              </div>
              <div className="stack" style={{ gap: '0.5rem' }}>
                <label className="btn btn-sm" style={{ cursor: uploadSignature.isPending ? 'wait' : 'pointer' }}>
                  <Upload size={14} />
                  Upload signature
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    disabled={uploadSignature.isPending}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadSignature.mutate(f)
                    }}
                  />
                </label>
                {brandQ.data?.has_signature && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={deleteSignature.isPending}
                    onClick={() => deleteSignature.mutate()}
                  >
                    <Trash2 size={14} />
                    Remove signature
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">PNG, JPEG, or WebP · max 500&nbsp;KB · appears on quotation PDFs</p>
            {uploadSignature.isError && <p className="error small">{(uploadSignature.error as Error).message}</p>}
          </div>

          <div className="card stack">
            <div className="section-title row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <Palette size={18} />
              UPI QR Code
            </div>
            <div className="row" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 12,
                  border: '1px dashed #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#f8fafc',
                  overflow: 'hidden',
                }}
              >
                {upiQrPreviewUrl ? (
                  <img src={upiQrPreviewUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span className="muted small">No QR code</span>
                )}
              </div>
              <div className="stack" style={{ gap: '0.5rem' }}>
                <label className="btn btn-sm" style={{ cursor: uploadUpiQr.isPending ? 'wait' : 'pointer' }}>
                  <Upload size={14} />
                  Upload QR code
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    disabled={uploadUpiQr.isPending}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) uploadUpiQr.mutate(f)
                    }}
                  />
                </label>
                {brandQ.data?.has_upi_qr && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={deleteUpiQr.isPending}
                    onClick={() => deleteUpiQr.mutate()}
                  >
                    <Trash2 size={14} />
                    Remove QR code
                  </button>
                )}
              </div>
            </div>
            <p className="muted small">PNG, JPEG, or WebP · max 200&nbsp;KB · payment QR code for invoices</p>
            {uploadUpiQr.isError && <p className="error small">{(uploadUpiQr.error as Error).message}</p>}
          </div>

          <form className="card stack" onSubmit={onSubmit}>
            <div className="section-title">Business details</div>
            <div className="form-field">
              <label className="input-label" htmlFor="legal">
                Legal / trading name
              </label>
              <input
                id="legal"
                className="input"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder={membership?.organization?.name ?? 'Company name'}
                autoComplete="organization"
              />
            </div>
            <div className="form-field">
              <label className="input-label" htmlFor="addr">
                Address
              </label>
              <textarea
                id="addr"
                className="input"
                rows={4}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, city, postal code, country"
              />
            </div>
            <div className="form-field">
              <label className="input-label" htmlFor="phone">
                Phone
              </label>
              <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="input-label" htmlFor="email">
                Billing email
              </label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="input-label" htmlFor="web">
                Website
              </label>
              <input id="web" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="input-label" htmlFor="tax">
                Tax ID (GST / VAT / etc.)
              </label>
              <input id="tax" className="input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            {save.isError && <p className="error small">{(save.error as Error).message}</p>}
            {save.isSuccess && !save.isPending && <p className="success small">Saved.</p>}
            <button type="submit" className="btn" disabled={save.isPending}>
              Save details
            </button>
          </form>
        </div>

        <div className="card stack">
          <div className="section-title row" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} />
            Product Catalog
          </div>

          <div>
            <p className="muted small" style={{ marginBottom: '0.75rem' }}>
              Upload any CSV export — we auto-detect columns (e.g. product name, price, rate, MRP, SKU).
              Comma, semicolon, or tab separators work. Prices can include ₹, commas, or decimals.
            </p>
            <label className="btn btn-sm" style={{ cursor: uploadCatalog.isPending ? 'wait' : 'pointer' }}>
              <Upload size={14} />
              Upload CSV
              <input
                type="file"
                accept=".csv"
                hidden
                disabled={uploadCatalog.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) uploadCatalog.mutate(f)
                }}
              />
            </label>
            {uploadCatalog.isError && <p className="error small" style={{ marginTop: '0.5rem' }}>{(uploadCatalog.error as Error).message}</p>}
            {uploadCatalog.isSuccess && !uploadCatalog.isPending && (
              <div className="success small" style={{ marginTop: '0.5rem' }}>
                Uploaded {(uploadCatalog.data as { items_created: number }).items_created} item(s).
                {(uploadCatalog.data as { column_mapping?: Record<string, string> }).column_mapping && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <strong>Detected columns:</strong>
                    <ul style={{ marginTop: '0.25rem', paddingLeft: '1.25rem' }}>
                      {Object.entries((uploadCatalog.data as { column_mapping: Record<string, string> }).column_mapping).map(([k, v]) => (
                        <li key={k}>{k} → {v}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(uploadCatalog.data as { warnings?: string[] }).warnings?.length ? (
                  <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', color: '#b45309' }}>
                    {(uploadCatalog.data as { warnings: string[] }).warnings.map((w, i) => (
                      <li key={i} style={{ fontSize: '0.85rem' }}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                {(uploadCatalog.data as { errors: string[] }).errors?.length > 0 && (
                  <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                    {(uploadCatalog.data as { errors: string[] }).errors.map((err, i) => (
                      <li key={i} style={{ fontSize: '0.85rem' }}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {catalogQ.data?.items && catalogQ.data.items.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div className="input-label" style={{ marginBottom: '0.5rem' }}>Items in catalog ({catalogQ.data.items.length})</div>
              <div className="stack" style={{ gap: '0.5rem', maxHeight: '300px', overflow: 'auto' }}>
                {catalogQ.data.items.map((item) => (
                  <div key={item.id} className="row spread" style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '0.375rem', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.name}</div>
                      {item.description && <div className="muted small">{item.description}</div>}
                      <div className="muted small">₹{item.unit_price.toLocaleString('en-IN')}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={deleteCatalogItem.isPending}
                      onClick={() => deleteCatalogItem.mutate(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {catalogQ.isLoading && <p className="muted small">Loading catalog…</p>}
        </div>
      </div>
    </>
  )
}

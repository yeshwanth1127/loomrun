import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Palette, Shield, Trash2, Upload } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type BrandPayload = {
  legal_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  tax_id: string | null
  has_logo: boolean
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

  const brandQ = useQuery({
    queryKey: ['org-brand', orgId],
    enabled: !!orgId,
    queryFn: () => apiFetch<BrandPayload>(`/v1/orgs/${orgId}/brand`),
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

      <div className="page-body stack" style={{ maxWidth: 560 }}>
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
    </>
  )
}

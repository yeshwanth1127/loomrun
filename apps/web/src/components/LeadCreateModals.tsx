import { useMutation } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { apiFetch, apiUpload } from '../lib/api'
import { SAMPLE_LEADS_CSV, SOURCES, SOURCE_LABELS } from '../lib/leads'
import { Modal } from './ui/Modal'

type CsvImportResult = {
  created: number
  skipped: number
  errors: string[]
  warnings: string[]
  column_mapping: Record<string, string>
}

export function AddLeadModal({
  orgId,
  open,
  onClose,
  onCreated,
}: {
  orgId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [source, setSource] = useState('MANUAL')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [productInterest, setProductInterest] = useState('')
  const [quantityEstimate, setQuantityEstimate] = useState('')
  const [value, setValue] = useState('')
  const [notes, setNotes] = useState('')

  function reset() {
    setTitle('')
    setCompany('')
    setSource('MANUAL')
    setPhone('')
    setEmail('')
    setCity('')
    setProductInterest('')
    setQuantityEstimate('')
    setValue('')
    setNotes('')
  }

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(`/v1/orgs/${orgId}/leads`, {
        method: 'POST',
        json: {
          title,
          source,
          stage: 'NEW',
          company: company || undefined,
          phone: phone || undefined,
          email: email || undefined,
          city: city || undefined,
          product_interest: productInterest || undefined,
          quantity_estimate: quantityEstimate || undefined,
          notes: notes || undefined,
          estimated_value: value ? Number(value) : undefined,
        },
      }),
    onSuccess: () => {
      toast.success('Lead created')
      reset()
      onCreated()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add lead" size="lg">
      <form id="add-lead-form" onSubmit={submit} className="stack" style={{ gap: '0.85rem' }}>
        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ flex: '1 1 220px' }}>
            <label className="input-label">Name / Title *</label>
            <input
              className="input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Who is this lead?"
            />
          </div>
          <div className="form-field" style={{ flex: '1 1 220px' }}>
            <label className="input-label">Company name</label>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ flex: '1 1 160px' }}>
            <label className="input-label">Where did it come from?</label>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ flex: '1 1 160px' }}>
            <label className="input-label">Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-field" style={{ flex: '1 1 160px' }}>
            <label className="input-label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: '1 1 160px' }}>
            <label className="input-label">City</label>
            <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ flex: '1 1 200px' }}>
            <label className="input-label">What do they want?</label>
            <input
              className="input"
              value={productInterest}
              onChange={(e) => setProductInterest(e.target.value)}
              placeholder="Polo t-shirts, uniforms…"
            />
          </div>
          <div className="form-field" style={{ flex: '1 1 120px' }}>
            <label className="input-label">Quantity</label>
            <input
              className="input"
              value={quantityEstimate}
              onChange={(e) => setQuantityEstimate(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: '1 1 140px' }}>
            <label className="input-label">Order value (₹)</label>
            <input
              className="input"
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>

        <div className="form-field">
          <label className="input-label">Notes</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </form>

      <div className="row" style={{ gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          form="add-lead-form"
          className="btn"
          disabled={create.isPending || !title.trim()}
        >
          {create.isPending ? 'Saving…' : 'Add lead'}
        </button>
      </div>
    </Modal>
  )
}

export function ImportCsvModal({
  orgId,
  open,
  onClose,
  onImported,
}: {
  orgId: string
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: (f: File) => apiUpload<CsvImportResult>(`/v1/orgs/${orgId}/leads/upload-csv`, f),
    onSuccess: (data) => {
      setResult(data)
      if (data.created > 0) toast.success(`${data.created} lead(s) imported`)
      else if (data.skipped > 0) toast.message('No new leads — existing matches were skipped')
      onImported()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function downloadSample() {
    const blob = new Blob([SAMPLE_LEADS_CSV], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'loomrun-leads-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={open} onClose={onClose} title="Import leads from a spreadsheet" size="lg">
      <p className="muted small" style={{ marginBottom: '0.85rem' }}>
        Upload a CSV export from IndiaMART, WhatsApp, or your own sheet. Columns are matched
        automatically and duplicates are skipped.
      </p>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          <Upload size={14} />
          {file ? file.name : 'Choose CSV file'}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setFile(f)
              setResult(null)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={downloadSample}>
          Download sample
        </button>
      </div>

      {result && (
        <div className="card-sm stack" style={{ gap: '0.5rem' }}>
          <strong className="small">
            Imported {result.created}
            {result.skipped > 0 ? ` · skipped ${result.skipped} duplicate(s)` : ''}
          </strong>
          {Object.keys(result.column_mapping).length > 0 && (
            <div className="muted small">
              {Object.entries(result.column_mapping).map(([k, v]) => (
                <div key={k}>
                  {k} → {v}
                </div>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && (
            <ul className="muted small" style={{ paddingLeft: '1rem' }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {result.errors.length > 0 && (
            <ul className="error small" style={{ paddingLeft: '1rem' }}>
              {result.errors.slice(0, 12).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="row" style={{ gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="btn"
          disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate(file)}
        >
          {upload.isPending ? 'Importing…' : 'Import leads'}
        </button>
      </div>
    </Modal>
  )
}

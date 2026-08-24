import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

export type LeadOption = {
  id: string
  title: string
  phone?: string | null
  company?: string | null
  email?: string | null
  stage?: string
}

type Props = {
  orgId: string
  value: string
  onChange: (leadId: string, lead: LeadOption | null) => void
  required?: boolean
  placeholder?: string
}

export function LeadSearchSelect({
  orgId,
  value,
  onChange,
  required,
  placeholder = 'Search by lead name, phone, or company…',
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!value) {
      setSelectedLead(null)
      return
    }
    if (selectedLead?.id === value) return
    let cancelled = false
    void apiFetch<{
      id: string
      title: string
      phone?: string | null
      company?: string | null
      email?: string | null
      stage?: string
    }>(`/v1/orgs/${orgId}/leads/${value}`)
      .then((lead) => {
        if (cancelled) return
        setSelectedLead(lead)
      })
      .catch(() => {
        if (!cancelled) setSelectedLead(null)
      })
    return () => {
      cancelled = true
    }
  }, [orgId, value, selectedLead?.id])

  const leadsQ = useQuery({
    queryKey: ['leads-picker', orgId, debouncedQuery],
    enabled: !!orgId && open,
    queryFn: () => {
      const params = new URLSearchParams({
        day: 'all',
        limit: '50',
        include_last_call: 'false',
      })
      if (debouncedQuery) params.set('search', debouncedQuery)
      return apiFetch<{ items: LeadOption[] }>(`/v1/orgs/${orgId}/leads?${params}`)
    },
  })

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const items = leadsQ.data?.items ?? []

  function pick(lead: LeadOption) {
    setSelectedLead(lead)
    setQuery('')
    setDebouncedQuery('')
    onChange(lead.id, lead)
    setOpen(false)
  }

  function clear() {
    setSelectedLead(null)
    setQuery('')
    setDebouncedQuery('')
    onChange('', null)
  }

  return (
    <div ref={rootRef} className="lead-search-select">
      {value && selectedLead ? (
        <div className="lead-search-selected">
          <div className="lead-search-selected-body">
            <span className="lead-search-option-title">{selectedLead.title}</span>
            <span className="lead-search-option-meta">
              {selectedLead.phone || 'No phone'}
            </span>
            <span className="lead-search-option-meta">
              {selectedLead.company || 'No company'}
            </span>
          </div>
          <button type="button" className="lead-search-clear" onClick={clear} aria-label="Clear lead">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="lead-search-input-wrap">
          <Search size={15} className="lead-search-icon" />
          <input
            className="input lead-search-input"
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={placeholder}
            value={query}
            required={required && !value}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
          />
        </div>
      )}

      {open && !value && (
        <div id={listId} className="lead-search-dropdown" role="listbox">
          {leadsQ.isLoading && <div className="lead-search-empty">Searching…</div>}
          {leadsQ.error && (
            <div className="lead-search-empty error">{(leadsQ.error as Error).message}</div>
          )}
          {!leadsQ.isLoading && !leadsQ.error && items.length === 0 && (
            <div className="lead-search-empty">
              {debouncedQuery ? 'No leads match your search.' : 'No leads found.'}
            </div>
          )}
          {items.map((lead) => (
            <button
              key={lead.id}
              type="button"
              role="option"
              className="lead-search-option"
              onClick={() => pick(lead)}
            >
              <span className="lead-search-option-title">{lead.title}</span>
              <span className="lead-search-option-meta">{lead.phone || 'No phone'}</span>
              <span className="lead-search-option-meta">{lead.company || 'No company'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

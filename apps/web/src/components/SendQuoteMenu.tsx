import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Mail, MessageCircle, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { apiFetch } from '../lib/api'
import { routes } from '../lib/appRoutes'

type QuotationRow = {
  id: string
  lead_id: string
  number: string
  pdf_url: string | null
  status: string
}

/**
 * Send the lead's ready quotation over WhatsApp or email.
 *
 * Picks the first quotation for the lead that already has a PDF — the same rule the
 * legacy Leads drawer and Telecaller page used, so behaviour is unchanged.
 */
export function SendQuoteMenu({
  orgId,
  leadId,
  phone,
  email,
  size = 'sm',
}: {
  orgId: string
  leadId: string
  phone: string | null
  email: string | null
  size?: 'sm' | 'md'
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sendQuote = useMutation({
    mutationFn: async (channel: 'whatsapp' | 'email') => {
      if (channel === 'whatsapp' && !phone) throw new Error('This lead has no phone number')
      if (channel === 'email' && !email) throw new Error('This lead has no email address')
      const { items } = await apiFetch<{ items: QuotationRow[] }>(
        `/v1/orgs/${orgId}/quotations?day=all&doc=quotation`,
      )
      const forLead = items.filter((q) => q.lead_id === leadId)
      const ready = forLead.find((q) => !!q.pdf_url)
      if (!ready) {
        const draft = forLead.find((q) => !q.pdf_url)
        if (draft) {
          navigate(routes.quotes)
          throw new Error(
            `Quotation ${draft.number} is still a draft — open it and generate the PDF before sending`,
          )
        }
        throw new Error('No quotation for this lead yet — create one under Quotes')
      }
      return apiFetch<{ message?: string; channel: string }>(
        `/v1/orgs/${orgId}/quotations/${ready.id}/send`,
        { method: 'POST', json: { channel, doc_type: 'quotation' } },
      )
    },
    onSuccess: (data, channel) => {
      setOpen(false)
      toast.success(
        data.message ?? `Quotation sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'email'}`,
      )
      void qc.invalidateQueries({ queryKey: ['lead-detail', orgId, leadId] })
      void qc.invalidateQueries({ queryKey: ['leads', orgId] })
      void qc.invalidateQueries({ queryKey: ['quotations', orgId] })
      void qc.invalidateQueries({
        queryKey: ['lead-quotations', orgId, leadId],
      })
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to send quotation'),
  })

  const btnClass = size === 'sm' ? 'btn btn-sm btn-secondary' : 'btn btn-secondary'

  return (
    <div className="quick-action-dropdown" ref={ref}>
      <button
        type="button"
        className={btnClass}
        onClick={() => setOpen((v) => !v)}
        disabled={sendQuote.isPending}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Send size={14} />
        {sendQuote.isPending ? 'Sending…' : 'Send quote'}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="quick-action-menu" role="menu">
          <button
            type="button"
            className="quick-action-menu-item"
            disabled={sendQuote.isPending || !phone}
            title={
              phone ? `Send quotation on WhatsApp to ${phone}` : 'This lead has no phone number'
            }
            onClick={() => sendQuote.mutate('whatsapp')}
          >
            <MessageCircle size={14} />
            WhatsApp
          </button>
          <button
            type="button"
            className="quick-action-menu-item"
            disabled={sendQuote.isPending || !email}
            title={email ? `Email quotation to ${email}` : 'This lead has no email address'}
            onClick={() => sendQuote.mutate('email')}
          >
            <Mail size={14} />
            Email
          </button>
        </div>
      )}
    </div>
  )
}

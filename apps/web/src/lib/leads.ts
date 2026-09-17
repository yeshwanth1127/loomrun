/** Lead vocabulary shared by the Sales workspace and the legacy Leads/Telecaller pages. */

export type Lead = {
  id: string
  title: string
  stage: string
  source: string
  lead_status: string
  pipeline_id?: string | null
  pipeline_stage_id?: string | null
  pipeline_name?: string | null
  pipeline_stage_name?: string | null
  region?: string | null
  sector?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  company: string | null
  phone: string | null
  email: string | null
  city: string | null
  product_interest: string | null
  quantity_estimate: string | null
  lead_score: number
  tags: string[]
  notes: string | null
  assignee_id: string | null
  next_follow_up_at: string | null
  last_activity_at: string | null
  estimated_value: number | null
  created_at: string
  updated_at: string
  last_call_outcome?: string | null
  last_call_logged_by?: string | null
  last_call_notes?: string | null
  last_call_at?: string | null
  activities?: LeadActivity[]
  assignee?: { id: string; name: string | null; email: string } | null
}

export type LeadActivity = {
  id: string
  type: string
  body: string
  user_id: string | null
  created_at: string
}

export type PipelineSummary = {
  id: string
  name: string
  is_default?: boolean
  is_active?: boolean
}

export const STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFICATION',
  'QUOTATION',
  'NEGOTIATION',
  'SAMPLE',
  'WON',
  'LOST',
]

export const OPEN_STAGES = STAGES.filter((s) => s !== 'WON' && s !== 'LOST')

/** Stages a lead sits in once a quote has gone out. */
export const QUOTED_STAGES = ['QUOTATION', 'NEGOTIATION', 'SAMPLE']

export const STAGE_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFICATION: 'Requirement Collected',
  QUOTATION: 'Quoted',
  NEGOTIATION: 'Negotiation',
  SAMPLE: 'Sample Sent',
  WON: 'Won',
  LOST: 'Lost',
}

export const STAGE_COLOR: Record<string, string> = {
  NEW: 'badge-slate',
  CONTACTED: 'badge-blue',
  QUALIFICATION: 'badge-indigo',
  QUOTATION: 'badge-purple',
  NEGOTIATION: 'badge-amber',
  SAMPLE: 'badge-amber',
  WON: 'badge-green',
  LOST: 'badge-red',
}

export const SOURCES = [
  'META_ADS',
  'GOOGLE_ADS',
  'INDIAMART',
  'WHATSAPP',
  'INSTAGRAM',
  'WEBSITE',
  'REFERRAL',
  'TELECALLER',
  'MANUAL',
  'OTHER',
]

export const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  TELECALLER: 'Telecaller',
  INSTAGRAM: 'Instagram',
  WEB: 'Website',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  META_ADS: 'Meta Ads',
  GOOGLE_ADS: 'Google Ads',
  INDIAMART: 'IndiaMART',
  MANUAL: 'Manual',
  OTHER: 'Other',
}

export const ACTIVITY_ICONS: Record<string, string> = {
  CALL: '📞',
  WHATSAPP: '💬',
  EMAIL: '✉️',
  NOTE: '📝',
  STAGE_CHANGE: '🔄',
  ASSIGNMENT: '👤',
  SYSTEM: '⚙️',
}

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  WRONG_NUMBER: 'Wrong number',
  NOT_INTERESTED: 'Not interested',
  CALLBACK_SCHEDULED: 'Follow Up',
  QUALIFIED: 'Qualified',
  CONNECTED_INTERESTED: 'Connected - Interested',
  CONNECTED_NOT_INTERESTED: 'Connected - Not Interested',
  RINGING_NO_RESPONSE: 'Ringing - No Response',
  SWITCHED_OFF: 'Switched Off / Not Reachable',
  ORDER_CONFIRMED: 'Order Confirmed',
}

export const SAMPLE_LEADS_CSV = `name,phone,email,company,city,source,stage,product,quantity,notes,value,date
Rahul Sharma,9876543210,rahul@acme.com,Acme Textiles,Surat,IndiaMART,Quoted,Polo t-shirts,500,Repeat buyer,25000,2024-08-15
Priya Patel,9123456789,priya@example.com,Patel Exports,Mumbai,WhatsApp,New,Uniforms,200,,12000,2024-09-01
`

export function scoreClass(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green'
  if (score >= 30) return 'amber'
  return 'red'
}

export function scoreStroke(score: number): string {
  if (score >= 70) return '#10b981'
  if (score >= 30) return '#f59e0b'
  return '#ef4444'
}

export function fmtLeadDate(dt: string | null | undefined): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  })
}

export function fmtLeadDateTime(dt: string | null | undefined): string {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** ISO → value for `<input type="datetime-local">` in local time. */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

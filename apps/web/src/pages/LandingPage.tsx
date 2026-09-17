import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { NoolrunWordmark } from '../components/react-bits/NoolrunWordmark'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import '../styles/landing.css'

/* ── Inline icons, drawn to match the landing page line weight ── */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const ChatIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M4 11c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8c-1.1 0-2.2-.2-3.1-.6L4 20l1.3-4.6C4.5 14.1 4 12.6 4 11z" />
  </svg>
)

const LayersIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M12 3l8 4-8 4-8-4 8-4z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 16l8 4 8-4" />
  </svg>
)

const ClockIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
)

const NodeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="5" cy="17" r="1.6" />
    <circle cx="19" cy="17" r="1.6" />
    <path d="M12 6.6L6.3 15.7M12 6.6l5.7 9.1M6.6 17h10.8" />
  </svg>
)

const UserIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-4 3.5-6.5 7-6.5s7 2.5 7 6.5" />
  </svg>
)

const DocIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" />
    <path d="M14 3v4h4" />
    <path d="M9 12h6M9 15.5h6M9 9h3" />
  </svg>
)

const HeadsetIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M4 12.5v-1a8 8 0 0116 0v1" />
    <rect x="2.5" y="12.5" width="4" height="6" rx="1.5" />
    <rect x="17.5" y="12.5" width="4" height="6" rx="1.5" />
    <path d="M21.5 18.5a4 4 0 01-4 4h-2" />
  </svg>
)

const BarsIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M4 20V10M4 20h16" />
    <path d="M9 20v-6M14 20v-9M19 20v-4" />
  </svg>
)

const ArrowIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={1.8}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

const PhoneIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <path d="M6 3h3l1.5 4-2 1.5a12 12 0 006 6l1.5-2 4 1.5v3a2 2 0 01-2 2A16 16 0 014 5a2 2 0 012-2z" />
  </svg>
)

const GlobeIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18-2.5-2.6-2.5-15.4 0-18z" />
  </svg>
)

const MailIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3.5 6.5l8.5 6 8.5-6" />
  </svg>
)

const SheetIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 9.5h17M9 9.5V20M15 9.5V20" />
  </svg>
)

export function LandingPage() {
  useEffect(() => {
    document.title = 'Noolrun — Operations platform for garment manufacturers'
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.landing .reveal'))
    if (reduce || !('IntersectionObserver' in window)) {
      nodes.forEach((el) => el.classList.add('visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.15 },
    )
    nodes.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="logo" aria-label="Noolrun">
          <img src="/noolrun-logo.png?v=3" alt="Noolrun" className="logo-img" />
        </div>
        <div className="nav-links">
          <a href="#workflow">Workflow</a>
          <a href="#agent">Agent</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <ThemeToggle />
          <Link to="/login" className="nav-cta">Log in</Link>
          <Link to="/register" className="nav-btn">Sign up</Link>
        </div>
      </nav>

      <header className="hero">
        <NoolrunWordmark className="hero-wordmark" />
        <h1>Every order, every follow-up, one place.</h1>
        <p>
          Noolrun replaces scattered WhatsApp threads and spreadsheets with one system built around
          how garment manufacturing actually runs — from first enquiry to final dispatch.
        </p>
        <div className="cta-row">
          <Link to="/register" className="btn">Sign up</Link>
          <Link to="/login" className="link-underline">Log in</Link>
          <a href="#workflow" className="link-underline">See how it works</a>
        </div>
        <p className="hero-note">14-day trial · No card required · Set up in a week</p>
      </header>

      <section className="reveal">
        <div className="section-inner pains">
          <div className="pain">
            <div className="icon-circle"><ChatIcon /></div>
            <h3>Quotations get lost in chat</h3>
            <p>A lead replies, someone's away from their phone, and the follow-up never happens. No record, no reminder.</p>
          </div>
          <div className="pain">
            <div className="icon-circle"><LayersIcon /></div>
            <h3>No one knows where an order stands</h3>
            <p>Fabric, printing, stitching, QC — tracked on paper, or not tracked at all until dispatch is already late.</p>
          </div>
          <div className="pain">
            <div className="icon-circle"><ClockIcon /></div>
            <h3>Payments and dates slip</h3>
            <p>Balance payments go unchased and dispatch planning happens too late for anyone to catch it in time.</p>
          </div>
        </div>
      </section>

      <section id="workflow" className="reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">How it runs</div>
          <div className="workflow-row">
            <div className="step">
              <div className="step-num">01</div>
              <h4>Capture</h4>
              <p>Leads from WhatsApp, telecallers, website and referrals land in one place.</p>
            </div>
            <div className="step">
              <div className="step-num">02</div>
              <h4>Quote</h4>
              <p>Quotations generate from templates and go out as a numbered PDF.</p>
            </div>
            <div className="step">
              <div className="step-num">03</div>
              <h4>Follow up</h4>
              <p>WhatsApp reminders go out on their own when a quote sits unanswered.</p>
            </div>
            <div className="step">
              <div className="step-num">04</div>
              <h4>Produce</h4>
              <p>Fabric to dispatch, each stage tracked — status is a fact, not a guess.</p>
            </div>
            <div className="step">
              <div className="step-num">05</div>
              <h4>Report</h4>
              <p>Pending quotes, delays and collections — one screen, every morning.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="agent" className="agent reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Your AI agent</div>
          <div className="agent-layout">
            <div className="agent-intro">
              <div className="icon-circle"><NodeIcon /></div>
              <h3>Ask it like you'd ask your ops manager.</h3>
              <p>
                The Loomrun agent knows your leads, pipeline, production status and revenue — so
                instead of digging through screens, you just ask.
              </p>
              <div className="ask-input">
                <span>Ask Loomrun anything about your business…</span>
                <span className="ask-arrow"><ArrowIcon /></span>
              </div>
            </div>
            <div className="agent-example">
              <div className="agent-q">"Which quotations haven't been followed up in 3 days?"</div>
              <div className="agent-a">
                <span className="agent-tag">Agent</span>
                4 quotations are unanswered, including Sunrise Public School at ₹1.8L. Want reminders sent now?
              </div>
              <div className="agent-q">"What's stuck in production right now?"</div>
              <div className="agent-a">
                <span className="agent-tag">Agent</span>
                6 orders are past their stage due date. The oldest is 2,400 shirts sitting at printing since
                the 11th — 5 days over.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="features reveal">
        <div className="section-inner feature-grid">
          <div className="feature">
            <div className="feature-icon"><UserIcon /></div>
            <div>
              <h4>Lead &amp; CRM</h4>
              <p>Every enquiry, source-tagged and assigned — nothing sits unclaimed.</p>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><DocIcon /></div>
            <div>
              <h4>Quotation automation</h4>
              <p>Templated products, automatic numbering, PDF in minutes.</p>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><ChatIcon size={18} /></div>
            <div>
              <h4>WhatsApp follow-ups</h4>
              <p>Reminders for unanswered quotes and overdue reorders, sent on their own.</p>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><LayersIcon size={18} /></div>
            <div>
              <h4>Production tracking</h4>
              <p>Fabric to dispatch, stage by stage, visible to everyone who needs it.</p>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><HeadsetIcon /></div>
            <div>
              <h4>Telecaller workflow</h4>
              <p>Call assignment, retry logic and conversion tracking in one view.</p>
            </div>
          </div>
          <div className="feature">
            <div className="feature-icon"><BarsIcon /></div>
            <div>
              <h4>CEO dashboard</h4>
              <p>Pending quotes, delays, bottlenecks and collections — every morning.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="roles reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Who sees what</div>
          <p className="section-lead">
            Everyone opens the same system and sees only their own work — no shared logins, no
            spreadsheet sent around for editing.
          </p>
          <div className="roles-grid">
            <div className="role">
              <div className="role-name">Owner</div>
              <div className="role-sub">Full access</div>
              <ul className="role-list">
                <li>Revenue, margin and collections</li>
                <li>Every order and quotation</li>
                <li>Team, plan and integrations</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Sales</div>
              <div className="role-sub">Leads &amp; quotes</div>
              <ul className="role-list">
                <li>Their assigned pipeline</li>
                <li>Quotation builder and PDFs</li>
                <li>Follow-up queue for the day</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Telecaller</div>
              <div className="role-sub">Call queue</div>
              <ul className="role-list">
                <li>Today's call list, in order</li>
                <li>Outcome logging in one tap</li>
                <li>Automatic retry scheduling</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Production</div>
              <div className="role-sub">Floor stages</div>
              <ul className="role-list">
                <li>Orders at their stage only</li>
                <li>Stage sign-off with timestamps</li>
                <li>Delay flags before dispatch</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="numbers reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">What changes</div>
          <div className="numbers-row">
            <div className="number">
              <div className="number-val">0</div>
              <div className="number-label">Enquiries lost to a missed message</div>
            </div>
            <div className="number">
              <div className="number-val">4 min</div>
              <div className="number-label">From enquiry to a numbered quotation PDF</div>
            </div>
            <div className="number">
              <div className="number-val">1</div>
              <div className="number-label">Screen that answers "where is that order?"</div>
            </div>
            <div className="number">
              <div className="number-val">Daily</div>
              <div className="number-label">Collections and delay report, without asking</div>
            </div>
          </div>
        </div>
      </section>

      <section className="connections reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Where leads come from</div>
          <p className="section-lead">
            Loomrun picks enquiries up from the channels you already use, so nothing has to be
            re-typed into the system by hand.
          </p>
          <div className="connect-grid">
            <div className="connect">
              <div className="connect-dot"><ChatIcon size={16} /></div>
              <div>
                <h4>WhatsApp Business</h4>
                <p>Every message becomes a lead with its full thread attached.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><GlobeIcon /></div>
              <div>
                <h4>Meta lead ads</h4>
                <p>Facebook and Instagram forms sync in the moment they're submitted.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><PhoneIcon /></div>
              <div>
                <h4>Calls</h4>
                <p>Inbound and outbound calls logged against the right lead automatically.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><MailIcon /></div>
              <div>
                <h4>Website &amp; email</h4>
                <p>Contact forms and enquiry inboxes route straight into the pipeline.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><SheetIcon /></div>
              <div>
                <h4>Spreadsheet import</h4>
                <p>Bring your existing customer list across on day one.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><UserIcon size={16} /></div>
              <div>
                <h4>Walk-ins &amp; referrals</h4>
                <p>Added in seconds, tagged by source so you know what actually works.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="onboard reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Getting started</div>
          <div className="onboard-list">
            <div className="onboard-item">
              <div className="onboard-when">Day 1</div>
              <div>
                <h4>Your workspace, your catalogue</h4>
                <p>We set up your organisation, import your customer list, and load your products and rates so quotations are ready to send.</p>
              </div>
            </div>
            <div className="onboard-item">
              <div className="onboard-when">Day 2–3</div>
              <div>
                <h4>Channels connected</h4>
                <p>WhatsApp Business, Meta lead ads and telephony get linked, so new enquiries start arriving in Loomrun on their own.</p>
              </div>
            </div>
            <div className="onboard-item">
              <div className="onboard-when">Day 4–5</div>
              <div>
                <h4>Team trained on their own screen</h4>
                <p>Each role gets a short session on the view they'll actually use — sales, telecalling and the production floor separately.</p>
              </div>
            </div>
            <div className="onboard-item">
              <div className="onboard-when">Week 2</div>
              <div>
                <h4>Running on its own</h4>
                <p>Follow-ups go out automatically, production stages are being signed off, and the morning report lands without anyone compiling it.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="built-for reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Built around the floor</div>
          <p className="section-lead">
            Not a generic CRM with a textile label. The objects, stages and documents match how a
            garment unit actually works.
          </p>
          <div className="connect-grid">
            <div className="connect">
              <div className="connect-dot"><LayersIcon size={16} /></div>
              <div>
                <h4>Sizes and colorways</h4>
                <p>Quotes carry size runs and colour breaks, not a single line item pretending to be an order.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><SheetIcon /></div>
              <div>
                <h4>Fabric to stitch</h4>
                <p>Procurement, cutting, printing, stitching and QC are stages — signed off, with a timestamp.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><DocIcon size={16} /></div>
              <div>
                <h4>Numbered PDFs</h4>
                <p>Quotations and invoices use your templates, your numbering, your brand — ready to send.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><ClockIcon size={16} /></div>
              <div>
                <h4>Follow-ups that fire</h4>
                <p>Unanswered quotes and overdue reorders get a WhatsApp reminder without anyone remembering to send it.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><HeadsetIcon size={16} /></div>
              <div>
                <h4>A call list, in order</h4>
                <p>Telecallers open one queue. Outcomes log in a tap. Retries schedule themselves.</p>
              </div>
            </div>
            <div className="connect">
              <div className="connect-dot"><BarsIcon size={16} /></div>
              <div>
                <h4>A morning screen</h4>
                <p>Pending quotes, delayed orders and collections — one view, before the first meeting.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="replace reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">What you put down</div>
          <div className="pains">
            <div className="pain">
              <div className="icon-circle"><ChatIcon /></div>
              <h3>Scattered WhatsApp threads</h3>
              <p>Customers still message the same number. The thread becomes a lead record instead of living on one person's phone.</p>
            </div>
            <div className="pain">
              <div className="icon-circle"><SheetIcon size={20} /></div>
              <h3>Spreadsheets as the system</h3>
              <p>Rates, pipeline and production status stop living in files that go stale the moment someone is off the floor.</p>
            </div>
            <div className="pain">
              <div className="icon-circle"><ClockIcon /></div>
              <h3>Asking around for status</h3>
              <p>“Where is that order?” is a screen, not a walk to cutting, then printing, then a call to sales.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="trust reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Your data</div>
          <p className="section-lead">
            Each organisation is isolated. Roles see only their work. Revenue stays with the owner.
            Nothing is trained on your orders.
          </p>
          <div className="roles-grid">
            <div className="role">
              <div className="role-name">Per organisation</div>
              <div className="role-sub">Isolation</div>
              <ul className="role-list">
                <li>Leads, quotes and files stay inside your workspace</li>
                <li>No shared tenancy with another unit</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Per person</div>
              <div className="role-sub">Access</div>
              <ul className="role-list">
                <li>Named logins — not a password on the wall</li>
                <li>Sales, floor and owner see different screens</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Writes stay confirmed</div>
              <div className="role-sub">The agent</div>
              <ul className="role-list">
                <li>The agent can look up live facts immediately</li>
                <li>Sending a quote or changing a stage waits for a confirm</li>
              </ul>
            </div>
            <div className="role">
              <div className="role-name">Yours to leave</div>
              <div className="role-sub">Portability</div>
              <ul className="role-list">
                <li>Export what you brought in, and what you created</li>
                <li>Plans change without locking the data in</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="pricing reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Pricing</div>
          <div className="pricing-cols">
            <div className="price-col">
              <div className="plan-name">Growth</div>
              <div className="price">₹2,899<span>/month</span></div>
              <p>Up to 10 users. CRM, quotation automation, WhatsApp follow-ups, production tracking.</p>
              <ul className="plan-list">
                <li>Lead capture from every channel</li>
                <li>Quotation and invoice PDFs</li>
                <li>Automatic WhatsApp follow-ups</li>
                <li>Production stage tracking</li>
                <li>Email support</li>
              </ul>
            </div>
            <div className="price-col">
              <div className="plan-name">Scale</div>
              <div className="price">₹5,799<span>/month</span></div>
              <p>Everything in Growth, plus telecaller workflow and the CEO dashboard.</p>
              <ul className="plan-list">
                <li>Unlimited users</li>
                <li>Telecaller queue and call logging</li>
                <li>CEO dashboard and daily report</li>
                <li>Loomrun AI agent</li>
                <li>Priority support and onboarding</li>
              </ul>
            </div>
          </div>
          <p className="pricing-note">Billed monthly. 14-day trial on either plan — no card required.</p>
        </div>
      </section>

      <section className="faq reveal">
        <div className="section-inner">
          <div className="eyebrow-sm">Questions</div>
          <div className="faq-list">
            <div className="faq-item">
              <h4>Do we have to stop using WhatsApp?</h4>
              <p>No. Your customers keep messaging the same number — Loomrun sits behind it, turning each conversation into a lead record with the thread attached, so nothing depends on one person's phone.</p>
            </div>
            <div className="faq-item">
              <h4>What happens to the data we already have?</h4>
              <p>Customer lists, product catalogues and rate cards come across during setup. You start with your own data, not an empty system.</p>
            </div>
            <div className="faq-item">
              <h4>Will the floor team actually use it?</h4>
              <p>Production users see one screen with the orders at their stage and a single action to sign off. It's built to be used on a phone between machines, not at a desk.</p>
            </div>
            <div className="faq-item">
              <h4>Can we change plans later?</h4>
              <p>Yes — move between Growth and Scale whenever you need to. Nothing is locked in, and your data stays exactly as it is.</p>
            </div>
            <div className="faq-item">
              <h4>Who can see the revenue numbers?</h4>
              <p>Only the owner. Sales, telecalling and production roles see their own work and nothing else — access is set per role, per person.</p>
            </div>
            <div className="faq-item">
              <h4>Is this a WhatsApp bot?</h4>
              <p>No. It is the operations system behind the number you already use — CRM, quotations, production and follow-ups. WhatsApp is one of the channels, not the product.</p>
            </div>
            <div className="faq-item">
              <h4>How long does setup take?</h4>
              <p>Most units are quoting from Loomrun in the first week: catalogue and customers on day one, channels mid-week, the floor trained on their own screen before week two.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta reveal">
        <h2>See Loomrun on your own orders.</h2>
        <p>We'll walk through your current pipeline and show you what it looks like once it's in one place.</p>
        <div className="cta-row">
          <Link to="/register" className="btn">Sign up</Link>
          <Link to="/login" className="link-underline">Log in</Link>
        </div>
      </section>

      <footer>
        <div className="footer-inner">
          <div>
            <div className="footer-brand">
              <img src="/noolrun-logo.png?v=3" alt="Noolrun" className="footer-brand-img" />
            </div>
            <div>by Exora Solutions Pvt Limited</div>
            <div>AECS Layout, Brookfield, Bangalore</div>
          </div>
          <div className="footer-nav">
            <div className="footer-col">
              <div className="footer-col-title">Product</div>
              <a href="#workflow">Workflow</a>
              <a href="#agent">Agent</a>
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="footer-col">
              <div className="footer-col-title">Account</div>
              <Link to="/login">Log in</Link>
              <Link to="/register">Sign up</Link>
            </div>
          </div>
          <div>© 2026 Exora Solutions Pvt Limited</div>
        </div>
      </footer>
    </div>
  )
}

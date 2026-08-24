import Lenis from 'lenis'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** When false, renders a normal overflow container (for boards / chat). */
  enabled?: boolean
}

/** Smooth inertial scrolling for nested overflow containers (app main pane). */
export function SmoothScroll({ children, className, style, enabled = true }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const wrapper = wrapperRef.current
    const content = contentRef.current
    if (!wrapper || !content) return

    const lenis = new Lenis({
      wrapper,
      content,
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.4,
      wheelMultiplier: 0.9,
    })

    let rafId = 0
    const raf = (time: number) => {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [enabled])

  if (!enabled) {
    return (
      <div className={`smooth-scroll smooth-scroll--native ${className ?? ''}`.trim()} style={style}>
        {children}
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={`smooth-scroll ${className ?? ''}`.trim()} style={style}>
      <div ref={contentRef} className="smooth-scroll-content">
        {children}
      </div>
    </div>
  )
}

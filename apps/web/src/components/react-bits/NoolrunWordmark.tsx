import './NoolrunWordmark.css'

/** Cache-bust when logo assets are replaced. */
const LOGO_SRC = '/noolrun-logo.png?v=5'

type NoolrunWordmarkProps = {
  className?: string
  /** Slightly tighter treatment for nav / compact spots. */
  size?: 'hero' | 'nav' | 'auth'
}

export function NoolrunWordmark({ className = '', size = 'hero' }: NoolrunWordmarkProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="Noolrun"
      className={`noolrun-wordmark noolrun-wordmark--${size} ${className}`.trim()}
      draggable={false}
    />
  )
}

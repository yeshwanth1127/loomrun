import { useCallback, useEffect, useRef, useState } from 'react'

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export type UseSpeechSynthesisOptions = {
  lang?: string
}

/**
 * Browser Web Speech API (speechSynthesis). Reads text aloud via speak(),
 * cancel() stops immediately. Mirrors useSpeechToText's shape.
 */
export function useSpeechSynthesis(options: UseSpeechSynthesisOptions = {}) {
  const { lang = 'en-IN' } = options
  const [speaking, setSpeaking] = useState(false)
  const [supported] = useState(() => speechSynthesisSupported())
  const langRef = useRef(lang)
  langRef.current = lang

  const cancel = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  useEffect(() => () => cancel(), [cancel])

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = langRef.current
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      setSpeaking(true)
      window.speechSynthesis.speak(utterance)
    },
    [supported],
  )

  return { supported, speaking, speak, cancel }
}

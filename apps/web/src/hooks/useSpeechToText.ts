import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function speechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() != null
}

export type UseSpeechToTextOptions = {
  lang?: string
  onInterim?: (text: string) => void
  onFinal?: (transcript: string) => void
}

/**
 * Browser Web Speech API (Chrome / Edge). Click start → talk → click stop
 * to finalize transcript. Interim text streams via onInterim.
 */
export function useSpeechToText(options: UseSpeechToTextOptions = {}) {
  const { lang = 'en-IN' } = options
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => speechRecognitionSupported())
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalsRef = useRef<string[]>([])
  const interimRef = useRef('')
  const stoppingRef = useRef(false)
  const onInterimRef = useRef(options.onInterim)
  const onFinalRef = useRef(options.onFinal)
  onInterimRef.current = options.onInterim
  onFinalRef.current = options.onFinal

  const abortRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) return
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    try {
      rec.abort()
    } catch {
      /* ignore */
    }
    recognitionRef.current = null
  }, [])

  useEffect(() => () => abortRecognition(), [abortRecognition])

  const stop = useCallback(() => {
    if (!recognitionRef.current) {
      setListening(false)
      return
    }
    stoppingRef.current = true
    try {
      recognitionRef.current.stop()
    } catch {
      setListening(false)
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    abortRecognition()
    setError(null)
    finalsRef.current = []
    interimRef.current = ''
    stoppingRef.current = false

    const rec = new Ctor()
    recognitionRef.current = rec
    rec.continuous = true
    rec.interimResults = true
    rec.lang = lang

    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const piece = (result[0]?.transcript || '').trim()
        if (!piece) continue
        if (result.isFinal) {
          finalsRef.current.push(piece)
        } else {
          interim += (interim ? ' ' : '') + piece
        }
      }
      interimRef.current = interim
      const live = [...finalsRef.current, interim].filter(Boolean).join(' ')
      onInterimRef.current?.(live)
    }

    rec.onerror = (event) => {
      const code = event.error
      if (code === 'aborted' || code === 'no-speech') return
      if (code === 'not-allowed') {
        setError('Microphone permission denied. Allow mic access and try again.')
      } else {
        setError(`Voice input error: ${code}`)
      }
      stoppingRef.current = true
      setListening(false)
    }

    rec.onend = () => {
      const text = [...finalsRef.current, interimRef.current].filter(Boolean).join(' ').trim()
      recognitionRef.current = null
      setListening(false)
      interimRef.current = ''
      if (stoppingRef.current && text) {
        onFinalRef.current?.(text)
      }
      stoppingRef.current = false
    }

    try {
      rec.start()
      setListening(true)
    } catch {
      setError('Could not start the microphone. Check browser permissions.')
      setListening(false)
      recognitionRef.current = null
    }
  }, [abortRecognition, lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return {
    supported,
    listening,
    error,
    start,
    stop,
    toggle,
    clearError: () => setError(null),
  }
}

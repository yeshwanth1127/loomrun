import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type DateFilterMode = 'all' | 'date'

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

type DateFilterContextValue = {
  mode: DateFilterMode
  date: string
  dayParam: string
  isAll: boolean
  isToday: boolean
  setMode: (mode: DateFilterMode) => void
  setDate: (date: string) => void
  appendDay: (params: URLSearchParams) => void
}

const DateFilterContext = createContext<DateFilterContextValue | null>(null)

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DateFilterMode>('all')
  const [date, setDate] = useState(todayIsoDate)

  const dayParam = mode === 'all' ? 'all' : date
  const isAll = mode === 'all'
  const isToday = !isAll && date === todayIsoDate()

  const appendDay = useCallback(
    (params: URLSearchParams) => {
      params.set('day', dayParam)
    },
    [dayParam],
  )

  const value = useMemo(
    () => ({
      mode,
      date,
      dayParam,
      isAll,
      isToday,
      setMode,
      setDate,
      appendDay,
    }),
    [mode, date, dayParam, isAll, isToday, appendDay],
  )

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>
}

export function useDateFilter() {
  const ctx = useContext(DateFilterContext)
  if (!ctx) throw new Error('useDateFilter must be used within DateFilterProvider')
  return ctx
}

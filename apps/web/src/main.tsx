import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import 'lenis/dist/lenis.css'
import App from './App.tsx'
import { AgentActivityProvider } from './context/AgentActivityContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { DateFilterProvider } from './context/DateFilterContext.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <DateFilterProvider>
              <AgentActivityProvider>
                <App />
                <Toaster
                  richColors
                  position="top-right"
                  toastOptions={{
                    style: {
                      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                      borderRadius: '14px',
                    },
                  }}
                />
              </AgentActivityProvider>
            </DateFilterProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/features/auth'
import { routes } from '@/app/routes'

const router = createBrowserRouter(routes)

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider อยู่ในสุดของ QueryClientProvider เพราะตอน logout
          มันเรียก queryClient.clear() */}
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </AuthProvider>
    </QueryClientProvider>
  )
}

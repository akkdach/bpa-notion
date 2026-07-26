import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/features/auth'
import { useApplyTheme, useResolvedTheme } from '@/features/settings'
import { routes } from '@/app/routes'

const router = createBrowserRouter(routes)

export function App() {
  // แปะคลาส .dark บน <html> — ทำที่ราก เพราะธีมมีผลทั้งแอปไม่ใช่แค่หน้าตั้งค่า
  useApplyTheme()

  // ส่งธีมให้ Toaster ทาง prop เพราะ components/ui ห้าม import store
  const theme = useResolvedTheme()

  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider อยู่ในสุดของ QueryClientProvider เพราะตอน logout
          มันเรียก queryClient.clear() */}
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" theme={theme} />
      </AuthProvider>
    </QueryClientProvider>
  )
}

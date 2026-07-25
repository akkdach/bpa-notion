import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthForm, useAuth } from '@/features/auth'

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const { login, register } = useAuth()
  const navigate = useNavigate()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <AuthForm
        mode={mode}
        onSwitchMode={() => setMode(mode === 'login' ? 'register' : 'login')}
        onSubmit={async ({ email, password, name }) => {
          if (mode === 'register') await register({ email, password, name })
          else await login({ email, password })

          void navigate('/', { replace: true })
        }}
      />
    </main>
  )
}

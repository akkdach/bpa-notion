import { useState, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ═══════════════════════════════════════════════════════════════════════════
//  AuthForm — presentational
//
//  ไม่รู้จัก useAuth ไม่ยิง API เอง รับ onSubmit เข้ามา ทำให้ใช้ได้ทั้งหน้า
//  เข้าสู่ระบบและหน้าสมัคร และเอาไปวางใน storybook ได้โดยไม่ต้องมีเซิร์ฟเวอร์
// ═══════════════════════════════════════════════════════════════════════════

interface AuthFormProps {
  mode: 'login' | 'register'
  onSubmit: (values: { email: string; password: string; name: string }) => Promise<void>
  onSwitchMode: () => void
}

export function AuthForm({ mode, onSubmit, onSwitchMode }: AuthFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const isRegister = mode === 'register'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      await onSubmit({ email, password, name })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาด')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onSubmit={(event) => void handleSubmit(event)}
      className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-7 shadow-sm"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isRegister ? 'สร้างบัญชีเพื่อเริ่มใช้งาน' : 'ยินดีต้อนรับกลับมา'}
        </p>
      </header>

      {isRegister && (
        <div className="space-y-2">
          <Label htmlFor="name">ชื่อ</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="สมชาย ใจดี"
            autoComplete="name"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">อีเมล</Label>
        <Input
          id="email"
          // type="text" ไม่ใช่ "email" — เบราว์เซอร์ validate อีเมลที่มีอักษรไทย
          // ไม่ผ่าน ทั้งที่ระบบรองรับ (คอลัมน์เป็น citext ไม่ได้จำกัดชุดอักขระ)
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="somchai@example.com"
          autoComplete="username"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
        />
        {isRegister && (
          <p className="text-xs text-muted-foreground">
            อย่างน้อย 12 ตัวอักษร — ประโยคยาว ๆ ที่จำได้ปลอดภัยกว่ารหัสสั้นที่ซับซ้อน
          </p>
        )}
      </div>

      {error !== null && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </motion.p>
      )}

      <Button type="submit" className="w-full" disabled={isBusy}>
        {isBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {isRegister ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? 'มีบัญชีอยู่แล้ว?' : 'ยังไม่มีบัญชี?'}{' '}
        <button
          type="button"
          onClick={onSwitchMode}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {isRegister ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
        </button>
      </p>
    </motion.form>
  )
}

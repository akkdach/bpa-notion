import { useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/relativeTime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiToken, CreateApiTokenInput, CreatedApiToken } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
//  ส่วน "การเชื่อมต่อ AI" ของหน้าตั้งค่า — presentational
//
//  หน้านี้คือคำตอบของคำถาม "ลูกค้าจะเอา token มาจากไหน" — ก่อนหน้านี้ MCP ต้อง
//  เก็บอีเมล/รหัสผ่านของเจ้าของไว้ในไฟล์ config แล้ว login เอง ซึ่งแปลว่า
//  ถอนสิทธิ์เครื่องเดียวไม่ได้เลยนอกจากเปลี่ยนรหัสผ่านทั้งบัญชี
//
//  ⚠️ ค่าจริงของ token แสดงครั้งเดียวหลังกดสร้าง ฐานข้อมูลเก็บแค่ SHA-256
//     จึงไม่มีทางเรียกคืนได้ — UI ต้องทำให้ชัดว่า "คัดลอกเดี๋ยวนี้" ไม่ใช่ปล่อย
//     ให้คนคิดว่าเดี๋ยวกลับมาเปิดดูใหม่ได้
// ═══════════════════════════════════════════════════════════════════════════

const EXPIRY_CHOICES: { label: string; days: number | null }[] = [
  { label: 'ไม่มีวันหมดอายุ', days: null },
  { label: '30 วัน', days: 30 },
  { label: '90 วัน', days: 90 },
  { label: '1 ปี', days: 365 },
]

const STATUS_LABELS = { revoked: 'เพิกถอนแล้ว', expired: 'หมดอายุ' } as const

interface AiConnectionSettingsProps {
  tokens: ApiToken[]
  isLoading: boolean
  error: Error | null
  canManage: boolean
  isBusy: boolean
  onCreate: (input: CreateApiTokenInput) => Promise<CreatedApiToken>
  onRevoke: (tokenId: string) => Promise<void>
}

export function AiConnectionSettings({
  tokens, isLoading, error, canManage, isBusy, onCreate, onRevoke,
}: AiConnectionSettingsProps) {
  const [name, setName] = useState('')
  const [days, setDays] = useState<number | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ค่าจริงอยู่ใน state ของ component นี้เท่านั้น ปิดหน้าแล้วหายไปตามที่ควรเป็น
  const [created, setCreated] = useState<CreatedApiToken | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreateError(null)

    try {
      setCreated(await onCreate({ name: name.trim(), expiresInDays: days }))
      setName('')
      setCopied(false)
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'สร้าง token ไม่สำเร็จ')
    }
  }

  async function handleCopy(token: string) {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard ถูกปฏิเสธได้เมื่อหน้าไม่ได้อยู่บน https หรือผู้ใช้ไม่อนุญาต
      // — ค่าจริงยังอยู่บนจอให้เลือกคัดลอกเองอยู่แล้ว ไม่ต้องทำอะไรต่อ
      setCopied(false)
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">การเชื่อมต่อ AI</h2>
        <p className="text-sm text-muted-foreground">
          สร้าง token ให้ Claude Code เข้ามาอ่านและจัดการงานใน workspace นี้ผ่าน MCP
          — token หนึ่งใบผูกกับ workspace นี้ workspace เดียว
        </p>
      </header>

      {/* ─── ค่าจริงของใบที่เพิ่งสร้าง — โอกาสเดียวที่จะเห็น ─────────────── */}
      {created !== null && (
        <div className="space-y-3 rounded-xl border border-success/40 bg-success/5 p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">สร้าง “{created.name}” แล้ว</p>
            <p className="text-xs text-warning">
              คัดลอกเก็บไว้เดี๋ยวนี้ — ออกจากหน้านี้แล้วจะดูค่านี้อีกไม่ได้
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-xs"
              aria-label="ค่า token ที่เพิ่งสร้าง"
            >
              {created.token}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => void handleCopy(created.token)}
            >
              {copied
                ? <Check className="size-3.5" aria-hidden />
                : <Copy className="size-3.5" aria-hidden />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </Button>
          </div>

          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>เอาไปใช้ที่เครื่องซึ่งจะรัน Claude Code:</p>
            <code className="block font-mono break-all text-foreground">
              pwsh scripts/setup-mcp.ps1
            </code>
            <p>สคริปต์จะถามหา token นี้ แล้วตั้งค่าให้เอง — ดูขั้นตอนเต็มใน docs/RB-connect-ai.md</p>
          </div>

          <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>
            เก็บเรียบร้อยแล้ว
          </Button>
        </div>
      )}

      {/* ─── ออกใบใหม่ ──────────────────────────────────────────────────── */}
      {canManage ? (
        <form onSubmit={(event) => void handleCreate(event)} className="space-y-4 rounded-xl border p-4">
          <div className="space-y-2">
            <Label htmlFor="token-name">ชื่อ token</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="โน้ตบุ๊กสมชาย"
              maxLength={100}
              required
            />
            <p className="text-xs text-muted-foreground">
              ตั้งชื่อตามเครื่องที่จะใช้ เพื่อให้รู้ว่าต้องเพิกถอนใบไหนเมื่อเครื่องนั้นหาย
            </p>
          </div>

          <div className="space-y-2">
            <Label>วันหมดอายุ</Label>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={days === choice.days}
                  onClick={() => setDays(choice.days)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    days === choice.days
                      ? 'border-foreground bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={isBusy || name.trim().length === 0} className="gap-2">
            {isBusy
              ? <Loader2 className="size-4 animate-spin" aria-hidden />
              : <KeyRound className="size-4" aria-hidden />}
            สร้าง token
          </Button>

          {createError !== null && <p className="text-sm text-destructive">{createError}</p>}
        </form>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          ต้องเป็นเจ้าของหรือผู้ดูแลจึงจะออก token ได้
        </p>
      )}

      {/* ─── ใบที่ออกไปแล้ว ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">token ที่ออกไปแล้ว</h3>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : error !== null ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : tokens.length === 0 ? (
          <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
            ยังไม่มี token
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {tokens.map((token) => (
              <li key={token.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{token.name}</span>
                    <code className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
                      …{token.last4}
                    </code>
                    {token.status !== 'active' && (
                      <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {STATUS_LABELS[token.status]}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {/* "ยังไม่เคยถูกใช้" ต่างจาก "ใช้เมื่อสักครู่" อย่างมีความหมาย —
                        บอกได้ทันทีว่าเครื่องปลายทางตั้งค่าสำเร็จหรือยัง */}
                    {token.lastUsedAt === undefined
                      ? 'ยังไม่เคยถูกใช้'
                      : `ใช้ล่าสุด ${formatRelative(token.lastUsedAt)}`}
                    {token.expiresAt !== undefined &&
                      ` · หมดอายุ ${new Date(token.expiresAt).toLocaleDateString('th-TH')}`}
                  </p>
                </div>

                {canManage && token.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive"
                    aria-label={`เพิกถอน ${token.name}`}
                    disabled={isBusy}
                    onClick={() => void onRevoke(token.id)}
                  >
                    เพิกถอน
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          เพิกถอนแล้วมีผลกับคำขอถัดไปทันที ไม่ต้องรอหมดอายุและไม่ต้องแก้ไฟล์ที่เครื่องปลายทาง
        </p>
      </div>
    </section>
  )
}

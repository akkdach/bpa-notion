import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// ⚠️ shadcn generate ไฟล์นี้มาพร้อม useTheme() ของ next-themes ซึ่งแอปนี้ไม่เคยมี
//    ThemeProvider ของมันเลย — ค่าที่ได้จึงเป็น "system" ค้างตลอดและ toast ไม่เคย
//    เข้าธีมที่ผู้ใช้เลือก
//
//    ถอดออกแล้วรับ theme มาทาง prop แทน เพราะ components/ui ห้าม import store
//    (บังคับด้วย eslint-plugin-boundaries) — ผู้เรียกที่ระดับ app เป็นคนส่งเข้ามา
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

---
description: สรุปงานทั้งวันของทุกโปรเจกต์ แยกรายคน แล้วเขียนลง Notion (ProjectManagement)
argument-hint: "[วันที่ YYYY-MM-DD — เว้นว่าง = วันนี้]"
allowed-tools: Bash, PowerShell, Read, Grep, Glob, mcp__projectmanagement__find_pages, mcp__projectmanagement__get_page, mcp__projectmanagement__create_page, mcp__projectmanagement__append_content, mcp__projectmanagement__replace_content, mcp__projectmanagement__update_page
---

# สรุปงานทั้งวัน → Notion

สรุปงานของวัน **$1** (ไม่ระบุ = วันนี้) จากทุกโปรเจกต์ แยกว่าใครทำอะไร แล้วเขียนลงแอป ProjectManagement

## หลักการ

ทีมมี 5 คน ทำงานหลาย repo พร้อมกัน สรุปที่ไม่บอกว่า **ใครทำอะไร** ใช้ตามงานไม่ได้ —
และชื่อคนต้องมาจาก **หลักฐานจริง** ห้ามเดา

**อ่านจาก GitHub โดยตรง ไม่ใช่จาก git ในเครื่อง** — เพื่อให้เห็นงานของทุกคนที่ push แล้ว
ไม่ว่าเครื่องที่รันคำสั่งจะ clone repo ไหนไว้บ้าง (ทุกคนในทีมจึงได้ผลเหมือนกัน)

## ขั้นตอน

### 0. ตรวจ GitHub CLI

```powershell
$gh = if (Get-Command gh -ErrorAction SilentlyContinue) { 'gh' } else { "$env:ProgramFiles\GitHub CLI\gh.exe" }
& $gh auth status
```

- **ไม่พบ gh** → บอกผู้ใช้: `winget install --id GitHub.cli` แล้วเปิด terminal ใหม่
- **ยังไม่ล็อกอิน** → บอกผู้ใช้ให้รัน `gh auth login` เอง (ต้องยืนยันผ่านเบราว์เซอร์ ทำแทนไม่ได้) แล้วหยุด อย่าเดาข้อมูล

### 1. ดึง commit ของวันนั้นจาก GitHub

owner คือ **`akkdach`** (repo ของทีมทั้งหมดอยู่ใต้บัญชีนี้)

```powershell
$gh = if (Get-Command gh -ErrorAction SilentlyContinue) { 'gh' } else { "$env:ProgramFiles\GitHub CLI\gh.exe" }
$owner = 'akkdach'
$date  = '<YYYY-MM-DD>'
$since = "${date}T00:00:00+07:00"
$until = "${date}T23:59:59+07:00"

# เอาเฉพาะ repo ที่มีการ push ตั้งแต่วันนั้น — ตัด repo ที่ไม่มีทางมีงานออกก่อน
$repos = & $gh repo list $owner --limit 200 --json name,pushedAt |
  ConvertFrom-Json | Where-Object { $_.pushedAt -ge $since } | ForEach-Object { $_.name }

foreach ($r in $repos) {
  # ⚠️ ต้องไล่ทุก branch — ทีมนี้ทำงานบน uat-service_1 / icon-domain ไม่ใช่แค่ default
  $branches = & $gh api "repos/$owner/$r/branches?per_page=100" --jq '.[].name' 2>$null
  $seen = @{}
  $out = @()
  foreach ($b in $branches) {
    $lines = & $gh api "repos/$owner/$r/commits?sha=$b&since=$since&until=$until&per_page=100" `
      --jq '.[] | "\(.sha[0:7])|\(.commit.author.date)|\(.commit.author.name) <\(.commit.author.email)>|\(.commit.message | split("\n")[0])"' 2>$null
    foreach ($l in $lines) {
      $sha = $l.Split('|')[0]
      if (-not $seen.ContainsKey($sha)) { $seen[$sha] = $true; $out += $l }
    }
  }
  if ($out) { "=== $r ==="; $out | Sort-Object }
}
```

commit ไหนที่ชื่อไม่บอกว่าแก้อะไรจริง ให้อ่านรายละเอียดต่อ:
`& $gh api repos/akkdach/<repo>/commits/<sha> --jq '.commit.message'`
โดยเฉพาะ bug fix — สรุปต้องบอก **อาการ + สาเหตุ** ไม่ใช่แค่ชื่อ commit

### 2. แปลงชื่อ git เป็นชื่อคน

⚠️ **ต้องดูทั้งชื่อและอีเมล** — ชื่อซ้ำแต่คนละคนมีจริงในทีมนี้
(`unit7761-cpu` กับ `Akkdach` เคยใช้อีเมล `akkdach@gmail.com` ทั้งคู่)

| git author (ชื่อ + อีเมล) | คนจริง |
| --- | --- |
| `unit7761-cpu <akkdach@gmail.com>` · `unit7761-cpu <unit7761@gmail.com>` | **Ronnachai** |
| `Akkdach <akkdach@gmail.com>` · `Akkdach <41726159+akkdach@users.noreply.github.com>` | **อรรคเดช** |
| `Tawan Sakorn <Tawan.Sa@bevproasia.com>` · `TaWSaK <132742858+TaWSaK@users.noreply.github.com>` | **Tawan** |
| `Narathip1707 <narathip170747@gmail.com>` · `narathip <narathip170747@gmail.com>` | **Narathip** |
| `Tinnakon Roiphayom <tinnakonnook@gmail.com>` | **ทินกร** |

**ยังไม่ยืนยัน — เจอแล้วต้องถามก่อน:**
`anukun` / `Anukul Supphakan` / `Anukun0587` `<laslas0587@gmail.com>` ·
`warunxx1005 <waruneethr@gmail.com>` · `Dutsadee <...@users.noreply.github.com>`

⚠️ เจอชื่อที่ไม่อยู่ในตาราง **ห้ามเดา** — ถามผู้ใช้ก่อน แล้วเติมลงตารางนี้
(ใส่ชื่อผิดในบันทึกทีม แย่กว่าถามหนึ่งคำถาม)

งานที่สั่งผ่าน Claude Code นับเป็นของ **คนที่สั่ง** (เจ้าของ commit) ไม่ใช่ของ AI

### 3. เขียนลง Notion

**ก) หน้าสรุปรายวัน** — สร้างหน้าลูกชื่อ `สรุปงาน <YYYY-MM-DD>` ใต้หน้า **📓 สรุปงานรายวัน**
(หาด้วย `find_pages` · ถ้ามีหน้าของวันนั้นอยู่แล้วให้ `get_page` อ่านก่อนแล้ว `replace_content` ไม่ใช่สร้างซ้ำ)

```
# สรุปงานวันที่ <วันที่>
**ภาพรวม:** ธีมหลักของวัน + จำนวน repo / commit / คนที่ทำ
---
## <ชื่อคนที่ 1>
### <หัวข้องาน>   ← ใช้ตารางถ้าการแก้เดียวกันกระทบหลายแอป
- **<เวลา>** <ทำอะไร>
## <ชื่อคนที่ 2>
...
---
## หมายเหตุการระบุชื่อ   ← บอกว่าชื่อมาจาก git author + mapping
## ค้างไว้                ← checklist ยกของค้างจากวันก่อนมาด้วย
```

**ข) หน้าโปรเจกต์รายตัว** — ทุก repo ที่มีงานวันนั้น `append_content` ต่อท้ายหน้าโปรเจกต์นั้น:

```
## อัปเดต <วันที่>
**<ชื่อคน>**
- **<เวลา>** <ทำอะไร>
```

### 4. รายงานผู้ใช้

สรุปสั้น ๆ ว่าใครทำอะไร + ลิงก์หน้าสรุป + บอกตรง ๆ ว่าอะไรที่สรุปไม่ครอบคลุม

## กติกาเนื้อหา

- ✅ เอา: แก้บั๊ก (พร้อมอาการ+สาเหตุ) · เพิ่ม/ลบฟีเจอร์ · deploy · migration · เอกสารที่สร้าง/แก้
- ❌ ไม่เอา: คำถามเชิงทำความเข้าใจ · การอธิบาย · บทสนทนาระหว่างทาง — หน้าสรุปคือ **changelog ไม่ใช่ log บทสนทนา**
- ตารางใช้ได้ · ` ```mermaid ` แสดงเป็นแผนภาพจริง · รูปใส่ได้เฉพาะ URL
- บั๊กที่กระทบความปลอดภัยหรือทำให้ข้อมูลผิด ทำเครื่องหมาย 🔴 ให้เห็นเด่น

## ข้อจำกัดที่ต้องบอกผู้ใช้เสมอ

- เห็นเฉพาะงานที่ **push ขึ้น GitHub แล้ว** — ที่ commit ค้างในเครื่องยังไม่ขึ้น
- งานที่ไม่ใช่โค้ด (ประชุม ตรวจระบบ คุยกับทีม) ไม่ปรากฏ ต้องให้ผู้ใช้เติมเอง
- repo ที่ไม่ได้อยู่ใต้บัญชี `akkdach` จะไม่ถูกสแกน

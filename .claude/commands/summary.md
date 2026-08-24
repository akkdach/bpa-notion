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

# ─── หา repo ที่ "คนรันคำสั่ง" มีสิทธิ์เห็น ────────────────────────────
# ⚠️ ต้องรวมสองแหล่ง ไม่ใช่แหล่งเดียว:
#   1. repo list <owner> — เห็นเฉพาะ public เมื่อ owner เป็นบัญชีของ "คนอื่น"
#   2. user/repos?affiliation=collaborator — private ที่เราถูกเชิญเข้าไป
# ถ้าใช้แค่ (1) คนในทีมที่ไม่ใช่เจ้าของ repo จะได้สรุปว่างเปล่าทั้งที่มีสิทธิ์อยู่
$mine = & $gh api "user/repos?per_page=100&affiliation=owner,collaborator,organization_member" `
  --paginate --jq ".[] | select(.owner.login==\"$owner\") | \"\(.name)|\(.pushed_at)\"" 2>$null
$theirs = & $gh repo list $owner --limit 200 --json name,pushedAt `
  --jq '.[] | "\(.name)|\(.pushedAt)"' 2>$null

$repos = @($mine) + @($theirs) | Where-Object { $_ } | ForEach-Object {
  $p = $_.Split('|'); [pscustomobject]@{ name = $p[0]; pushedAt = $p[1] }
} | Where-Object { $_.pushedAt -ge $since } |
    Sort-Object name -Unique | ForEach-Object { $_.name }

if (-not $repos) {
  # ไม่ใช่ "ไม่มีงาน" เสมอไป — อาจแปลว่ายังไม่ถูกเชิญเข้า repo เลย
  "⚠️ ไม่พบ repo ที่เข้าถึงได้ใต้บัญชี $owner — ตรวจว่าถูกเชิญเป็น collaborator แล้วหรือยัง"
}

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
(หาด้วย `find_pages` · ถ้ามีหน้าของวันนั้นอยู่แล้วให้ `get_page` อ่านก่อน)

> 🔴 **ห้ามเขียนทับทันทีถ้าหน้ามีอยู่แล้ว — ต้องเทียบก่อน**
>
> คนละคนรันคำสั่งนี้จะเห็น repo ไม่เท่ากัน (ขึ้นกับสิทธิ์ GitHub ของแต่ละคน)
> ถ้าคนที่เห็น 3 repo เขียนทับหน้าที่คนเห็น 17 repo เขียนไว้ **ข้อมูลของคนอื่นหายทั้งหมด**
> และไม่มีปุ่มกู้คืนให้ผู้ใช้กด
>
> วิธีทำ: อ่านเนื้อหาเดิม แล้วดูว่ามีชื่อ repo หรือชื่อคนที่ **ไม่อยู่ในผลสแกนรอบนี้** ไหม
> - **ไม่มี** (ผลรอบนี้ครอบคลุมของเดิมหมด) → `replace_content` ได้
> - **มี** → **ห้ามทับ** · ใช้ `append_content` เติมเฉพาะรายการใหม่ แล้วบอกผู้ใช้ว่า
>   เนื้อหาเดิมมี repo ที่บัญชีนี้มองไม่เห็น จึงไม่แตะของเดิม

หน้าสรุปเป็นเอกสาร **ชนิด RN ชั้น A (เครื่อง generate)** ตาม `docs/ST-documentation-standard.md`
ข้อ 5+7 — ต้องขึ้นต้นด้วยประกาศ AUTO-GENERATED + ตารางหัวเอกสารตามแบบนี้เสมอ
(ใช้ blockquote ไม่ใช่ HTML comment — หน้าแอปแปลง HTML เป็นบล็อกโค้ด):

```
# สรุปงานวันที่ <วันที่>

> ⚙️ AUTO-GENERATED — สร้างโดยคำสั่ง /summary จาก commit บน GitHub · อย่าแก้เนื้อหางานด้วยมือ (ข้อมูลผิดให้แก้ที่ commit แล้วรันใหม่) · เติมด้วยมือได้เฉพาะหัวข้อ "ค้างไว้" และงานที่ไม่ใช่โค้ด

| | |
|---|---|
| เวอร์ชันเอกสาร | <วันที่รันล่าสุด YYYY-MM-DD> |
| ชนิด / ชั้นเอกสาร | RN (Release Note) · ชั้น A — เครื่อง generate |
| แหล่งความจริง | git history ทุก repo ใต้บัญชี akkdach |

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
- **เห็นเฉพาะ repo ที่บัญชี GitHub ของคนรันมีสิทธิ์เข้าถึง** — repo private ที่ยังไม่ถูก
  เชิญเป็น collaborator จะไม่โผล่ · สรุปที่ได้จึงอาจไม่ครบเท่าของเจ้าของ repo
  ถ้าเจอกรณีนี้ ให้บอกผู้ใช้ไปขอสิทธิ์จากเจ้าของบัญชี `akkdach`
- งานที่ไม่ใช่โค้ด (ประชุม ตรวจระบบ คุยกับทีม) ไม่ปรากฏ ต้องให้ผู้ใช้เติมเอง
- repo ที่ไม่ได้อยู่ใต้บัญชี `akkdach` จะไม่ถูกสแกน

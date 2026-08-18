import { SetMetadata } from '@nestjs/common';

// ═══════════════════════════════════════════════════════════════════════════
//  metadata ที่ RequestContextInterceptor อ่าน
//
//  ⚠️ default คือ "ต้องล็อกอิน" — endpoint ที่ลืมใส่อะไรเลยจะถูกปิด ไม่ใช่เปิด
//     ตรงข้ามกับ ASP.NET ที่ต้องใส่ [Authorize] เอง แล้ว endpoint ที่ลืมใส่
//     กลายเป็นสาธารณะเงียบ ๆ
// ═══════════════════════════════════════════════════════════════════════════

export const IS_PUBLIC = 'pm:public';
export const REQUIRES_WORKSPACE = 'pm:requires-workspace';

/**
 * เข้าถึงได้โดยไม่ต้องล็อกอิน — login, register, refresh, health
 *
 * ⚠️ ถ้ามี Authorization header มาด้วย ระบบ "ยังตรวจ" ตามปกติ
 *    endpoint สาธารณะที่ยอมรับ token เสียเงียบ ๆ จะทำให้ /auth/refresh
 *    ทำงานต่อได้ด้วย token ที่ใช้ไม่ได้แล้ว
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * endpoint นี้ทำงานภายใน workspace หนึ่ง ๆ เท่านั้น
 *
 * ถ้าไม่มี header ตอบ 400 พร้อมบอกว่าขาดอะไร — ไม่ใช่ปล่อยให้ handler ไปเรียก
 * requireWorkspaceId() แล้วพังเป็น 500 ซึ่งไม่บอกผู้เรียกว่าต้องทำอะไร
 *
 * ไม่ได้ตรวจ "สิทธิ์" — interceptor ตรวจสมาชิกภาพให้แล้ว ที่นี่แค่ยืนยันว่ามี
 * context จริง ส่วน role ต่ำเกินไปเป็นเรื่องของ service (ดู isWorkspaceWideEditor)
 */
export const RequireWorkspace = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_WORKSPACE, true);

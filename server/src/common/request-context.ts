import { AsyncLocalStorage } from 'node:async_hooks';

import type { WorkspaceRole } from '../domain/roles.js';

// ═══════════════════════════════════════════════════════════════════════════
//  RequestContext — user + workspace ของ request ที่กำลังทำงานอยู่
//
//  แทน ITenantContext (scoped service) ฝั่ง C#
//
//  ── ทำไมเป็น AsyncLocalStorage ไม่ใช่ provider แบบ REQUEST scope ──────────
//  Nest จะสร้าง instance ใหม่ของ "ทั้งสายที่ inject มัน" ทุก request เมื่อมี
//  provider ตัวใดตัวหนึ่งเป็น REQUEST scope — service ที่ไม่เกี่ยวเลยก็โดนด้วย
//  ALS ให้ผลเหมือนกันโดยไม่ลาม และเป็นกลไกเดียวกับที่ DbService ใช้อยู่แล้ว
//
//  ── ต่างจาก PLAN.md โดยเจตนา (ยกมาจากของเดิม) ────────────────────────────
//  workspace มาจาก header X-Workspace-Id ไม่ใช่ claim ใน JWT แล้ว "ตรวจ
//  สมาชิกภาพทุก request" เหตุผล:
//
//    1. ถ้า workspace ฝังใน JWT อายุ 24 ชม. การถอด user ออกจาก workspace
//       จะไม่มีผลจนกว่า token หมดอายุ — คือช่องว่างด้านสิทธิ์ 24 ชั่วโมง
//    2. สลับ workspace ไม่ต้องออก token ใหม่
//
//  ราคาที่จ่ายคือ query ตรวจสมาชิกภาพ 1 ครั้งต่อ request — ซึ่งตอนนี้ถูกลง
//  กว่าเดิมเพราะมันรันอยู่ใน transaction เดียวกับ handler อยู่แล้ว
// ═══════════════════════════════════════════════════════════════════════════

export interface RequestContext {
  /** user ที่ล็อกอิน — null เมื่อเป็น endpoint สาธารณะ (login, register) */
  readonly userId: string | null;

  /** workspace ปัจจุบัน — null เมื่อ request ไม่ผูกกับ workspace (/me, list workspaces) */
  readonly workspaceId: string | null;

  /** สิทธิ์ของ user ใน workspace ปัจจุบัน */
  readonly role: WorkspaceRole | null;

  /** id ของ API token ที่ใช้ — null เมื่อมาด้วย JWT ของเบราว์เซอร์ */
  readonly apiTokenId: string | null;

  /**
   * memo ที่มีอายุเท่ากับ request เดียว
   *
   * ⚠️ จำเป็น ไม่ใช่ optimisation: การ render sidebar ถามสิทธิ์หลายสิบครั้งต่อ
   *    request และคำตอบเปลี่ยนไม่ได้ระหว่าง request เดียวกัน
   *
   * ⚠️ อยู่ตรงนี้ ไม่ใช่เป็น field ของ service เพราะ service ใน Nest เป็น
   *    singleton — field บน instance จะถูกใช้ร่วมกันข้าม request ซึ่งแปลว่า
   *    คำตอบเรื่อง "สิทธิ์" ของผู้ใช้คนหนึ่งจะไปตอบให้อีกคน
   */
  readonly cache: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => Promise<T>): Promise<T> =>
  storage.run(context, fn);

export const currentContext = (): RequestContext | undefined => storage.getStore();

/**
 * อ่าน userId แบบยืนยันว่าต้องมี
 *
 * ⚠️ throw ไม่ใช่คืน null โดยเจตนา — ถ้าโค้ดมาถึงจุดนี้โดยไม่มี user แปลว่า
 *    endpoint ลืมใส่ auth ซึ่งเป็นบั๊กที่ต้องรู้ทันที ไม่ใช่ 401 ที่ดูเหมือน
 *    "ผู้ใช้ยังไม่ล็อกอิน" แล้วซ่อนบั๊กไว้
 */
export function requireUserId(): string {
  const id = currentContext()?.userId;
  if (!id) throw new Error('ไม่มี user ใน context — endpoint นี้ลืมใส่ auth');
  return id;
}

export function requireWorkspaceId(): string {
  const id = currentContext()?.workspaceId;
  if (!id) throw new Error('ไม่มี workspace ใน context — endpoint นี้ลืมใส่ @RequireWorkspace()');
  return id;
}

export function requireRole(): WorkspaceRole {
  const role = currentContext()?.role;
  if (!role) throw new Error('ไม่มี role ใน context — endpoint นี้ลืมใส่ @RequireWorkspace()');
  return role;
}

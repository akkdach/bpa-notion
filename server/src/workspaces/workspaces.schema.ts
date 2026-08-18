import { z } from 'zod';

import { SLUG_MAX_LENGTH } from './slug.js';
import { WORKSPACE_ROLES, type UserKind, type WorkspaceRole } from '../domain/roles.js';

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ workspace').max(200, 'ชื่อยาวเกินไป'),
  slug: z.string().max(SLUG_MAX_LENGTH).nullish(),
  icon: z.string().max(200).nullish(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ workspace').max(200, 'ชื่อยาวเกินไป'),
  icon: z.string().max(200).nullable().optional(),
});

/** เพิ่มสมาชิกด้วยอีเมลของ user ที่สมัครไว้แล้ว — ไม่มีการเชิญทางอีเมล */
export const addMemberSchema = z.object({
  // ⚠️ ไม่ตรวจรูปแบบเข้มที่นี่ — อีเมลภาษาไทยใช้ได้ ดูเหตุผลที่ auth.schema.ts
  email: z.string().trim().min(1, 'กรุณากรอกอีเมล').max(320),
  role: z.enum(WORKSPACE_ROLES, {
    errorMap: () => ({ message: `สิทธิ์ต้องเป็นหนึ่งใน: ${WORKSPACE_ROLES.join(', ')}` }),
  }),
});

export const updateMemberSchema = z.object({
  role: z.enum(WORKSPACE_ROLES, {
    errorMap: () => ({ message: `สิทธิ์ต้องเป็นหนึ่งใน: ${WORKSPACE_ROLES.join(', ')}` }),
  }),

  /**
   * "human" หรือ "agent" — ไม่ส่ง = ไม่แตะ
   *
   * ⚠️ อยู่ที่ endpoint นี้เพราะ "บัญชีนี้คือบอท" เป็นสิ่งที่ owner/admin ยืนยัน
   *    ไม่ใช่สิ่งที่บัญชีประกาศเกี่ยวกับตัวเองตอนสมัคร — ถ้าใครตั้งเองได้ ก็ปลอม
   *    ให้การแก้ของตัวเองดูเหมือน AI ทำ (หรือกลับกัน) ได้ ซึ่งทำลายจุดประสงค์
   *    ของคอลัมน์นี้ทั้งหมด
   *
   * ⚠️ รับเป็น string แล้วให้ service ตรวจค่า ไม่ใช่ z.enum — เพราะ client เดิม
   *    คาด code `invalid_user_kind` ส่วน z.enum ให้ `validation_failed` เหมือน
   *    field อื่นทั้งหมด (smoke test ที่มีมาตั้งแต่ฝั่ง .NET จับข้อนี้ได้)
   */
  kind: z.string().nullish(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export interface WorkspaceSummaryDto {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  role: WorkspaceRole;
}

export interface WorkspaceDetailDto {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  myRole: WorkspaceRole;
  memberCount: number;
  createdAt: string;
}

/** @param kind "human" หรือ "agent" — ให้หน้าสมาชิกบอกได้ว่าอันไหนคือบัญชีของ AI */
export interface MemberDto {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  kind: UserKind;
  joinedAt: string;
}

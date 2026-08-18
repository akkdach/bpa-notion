import { z } from 'zod';

import type { UserKind } from '../domain/roles.js';

export const addNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'บันทึกว่างเปล่าไม่ได้')
    .max(
      4000,
      'บันทึกยาวเกิน 4000 ตัวอักษร — เนื้อหายาวควรอยู่ในหน้า ไม่ใช่ในบันทึก',
    ),
});

export type AddNoteInput = z.infer<typeof addNoteSchema>;

/** @param authorKind "human" / "agent" — ให้เจ้าของรู้ว่า AI เขียนหรือคนเขียน */
export interface NoteDto {
  id: string;
  pageId: string;
  authorUserId: string | null;
  authorName: string | null;
  authorKind: UserKind | null;
  body: string;
  createdAt: string;
}

export interface ActivityDto {
  id: number;
  /** null = หน้านั้นถูกลบถาวรไปแล้ว — ใช้ pageTitle ที่เก็บสำเนาไว้แสดงแทน */
  pageId: string | null;
  pageTitle: string;
  actorUserId: string | null;
  actorName: string | null;
  actorKind: UserKind | null;
  /** ดู domain/activity.ts — client ไม่ควร assume ว่ารู้จักครบ */
  action: string;
  /** JSON object มี "v" บอกเวอร์ชันของ schema เสมอ และมี from/to สำหรับการเปลี่ยนค่า */
  detail: unknown;
  createdAt: string;
}

export interface ActivityFeedDto {
  count: number;
  /** true = ถูกตัดที่ limit อาจมีมากกว่านี้ */
  truncated: boolean;
  items: ActivityDto[];
}

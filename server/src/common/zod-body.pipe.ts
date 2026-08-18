import { HttpException, HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
//  zodBody — validation อยู่ที่ schema ไม่กระจายอยู่ใน controller
//
//  แทน FluentValidation + ValidationFilter ฝั่ง C# ซึ่งต้องมี validator class
//  แยกต่อ DTO แล้วให้ filter ไปหาใน DI ที่นี่ schema กับ type เป็นของชิ้นเดียวกัน
//  — z.infer ทำให้ type ของ handler มาจาก schema โดยตรง ประกาศผิดที่เดียวไม่ได้
//
//  ⚠️ ต้องจัดการ "body ว่าง / ไม่ใช่ JSON" ด้วย ไม่ใช่แค่ field ผิด
//     ฝั่ง C# เคยเจอบั๊กนี้: body ที่อ่านไม่ได้ทำให้ argument เป็น null แล้วไป
//     พังเป็น NullReferenceException → 500 ซึ่งไม่บอกอะไรผู้เรียกเลย
//     ที่นี่ undefined/null ตกเข้า safeParse แล้วได้ 400 พร้อมเหตุผลจริง
// ═══════════════════════════════════════════════════════════════════════════
export function zodBody<T>(schema: ZodType<T>): PipeTransform<unknown, T> {
  return {
    transform(value: unknown): T {
      // ─────────────────────────────────────────────────────────────────
      //  ⚠️ "ไม่มี body เลย" ต่างจาก "body มีแต่ field ผิด" — และ client เดิม
      //     แยกสองอย่างนี้ด้วย code (invalid_body vs validation_failed)
      //
      //     เวอร์ชันแรกตอบ validation_failed ทั้งคู่ ซึ่ง smoke test ที่มีอยู่
      //     ตั้งแต่ฝั่ง .NET จับได้
      // ─────────────────────────────────────────────────────────────────
      if (value === undefined || value === null) {
        throw new HttpException(
          {
            success: false,
            message: 'อ่านข้อมูลใน request body ไม่ได้ — ต้องเป็น JSON',
            code: 'invalid_body',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;

      // รวมข้อความของ field เดียวกันเข้าด้วยกัน เพื่อให้ฝั่ง client แสดง
      // ใต้ input ที่ถูกต้องได้
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : '_';
        (errors[key] ??= []).push(issue.message);
      }

      throw new HttpException(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง',
          code: 'validation_failed',
          data: { errors },
        },
        HttpStatus.BAD_REQUEST,
      );
    },
  };
}

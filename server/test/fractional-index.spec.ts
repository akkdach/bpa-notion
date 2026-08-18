// ═══════════════════════════════════════════════════════════════════════════
//  fractional index — เทียบกับ fixture 4,701 เคสที่ยกมาจากฝั่ง .NET
//
//  fixture ชุดนี้ generate จาก npm `fractional-indexing` ตั้งแต่ตอนที่ฝั่ง C#
//  ต้องพิสูจน์ว่าพอร์ตมือแล้วยังตรงกับ client ทุกเคส
//
//  ที่นี่มันเปลี่ยนความหมายไป: ไม่ได้กัน "พอร์ตผิด" อีกแล้ว (ทั้งสองฝั่งเป็น JS)
//  แต่เป็น **สัญญากับ client** ว่า rank ที่เซิร์ฟเวอร์สร้างจะเรียงเหมือนกับที่
//  เบราว์เซอร์สร้าง ถ้าวันหนึ่งเปลี่ยนไปใช้ npm ตัวนั้นตรง ๆ fixture ชุดนี้คือ
//  สิ่งที่พิสูจน์ว่าค่าที่มีอยู่ในฐานแล้วยังใช้ต่อได้
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { between, betweenMany, FIRST_RANK, FractionalIndexError } from '../src/pages/fractional-index.js';

interface Case {
  a: string | null;
  b: string | null;
  expected: string;
}

const cases: Case[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/fractional-index-fixture.json'), 'utf8'),
) as Case[];

describe('between', () => {
  it(`ตรงกับ fixture ทั้ง ${cases.length} เคส`, () => {
    const wrong: string[] = [];

    for (const c of cases) {
      const actual = between(c.a, c.b);
      if (actual !== c.expected) {
        wrong.push(`between(${JSON.stringify(c.a)}, ${JSON.stringify(c.b)}) = ${actual} ควรเป็น ${c.expected}`);
      }
    }

    // รายงานเคสแรก ๆ ที่ผิด ไม่ใช่แค่ "จำนวน" — ตัวเลขอย่างเดียวหาสาเหตุไม่ได้
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(wrong).toHaveLength(0);
  });

  it('ยังไม่มีพี่น้องเลย → a0', () => {
    expect(between(null, null)).toBe(FIRST_RANK);
  });

  it('ผลลัพธ์เรียงถูกต้องเมื่อเทียบแบบ byte order', () => {
    // ⚠️ ข้อนี้คือสิ่งที่ COLLATE "C" ต้องรับประกันฝั่งฐาน — ถ้าคอลัมน์ใช้
    //    collation ของเครื่อง (ICU th-TH) ORDER BY จะให้ลำดับคนละอย่างกับที่นี่
    let previous = between(null, null);
    const ranks = [previous];

    for (let i = 0; i < 200; i++) {
      previous = between(previous, null);
      ranks.push(previous);
    }

    const sorted = [...ranks].sort();
    expect(sorted).toEqual(ranks);
  });

  it('แทรกตรงกลางซ้ำ ๆ ยังเรียงถูกและสตริงไม่ยาวเกินคอลัมน์', () => {
    let low = between(null, null);
    let high = between(low, null);

    for (let i = 0; i < 100; i++) {
      const mid = between(low, high);
      expect(low < mid && mid < high).toBe(true);
      // สลับข้างที่บีบเข้าไป เพื่อให้สตริงยาวจริง ๆ ไม่ใช่แค่ยาวด้านเดียว
      if (i % 2 === 0) low = mid;
      else high = mid;
    }

    expect(low.length).toBeLessThan(200); // varchar(200) ของคอลัมน์ rank
  });

  it('a >= b → error ไม่ใช่ค่าที่ใช้ไม่ได้เงียบ ๆ', () => {
    expect(() => between('a1', 'a0')).toThrow(FractionalIndexError);
    expect(() => between('a0', 'a0')).toThrow(FractionalIndexError);
  });

  it('rank ผิดรูปถูกปฏิเสธ', () => {
    expect(() => between('!!', null)).toThrow(FractionalIndexError);
    // ลงท้ายด้วยศูนย์ = ค่าไม่ unique ('a01' กับ 'a010' คือค่าเดียวกัน)
    expect(() => between('a01' + '0', null)).toThrow(FractionalIndexError);
  });
});

describe('betweenMany', () => {
  it('คืนค่าเรียงจากน้อยไปมากและอยู่ในช่วงที่ขอ', () => {
    for (const [a, b] of [
      [null, null],
      ['a0', null],
      [null, 'a5'],
      ['a1', 'a2'],
    ] as [string | null, string | null][]) {
      const many = betweenMany(a, b, 7);

      expect(many).toHaveLength(7);
      expect([...many].sort()).toEqual(many);
      if (a !== null) expect(a < many[0]!).toBe(true);
      if (b !== null) expect(many.at(-1)! < b).toBe(true);
    }
  });

  it('count <= 0 → ว่าง', () => {
    expect(betweenMany(null, null, 0)).toEqual([]);
    expect(betweenMany(null, null, -3)).toEqual([]);
  });
});

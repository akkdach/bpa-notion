// ═══════════════════════════════════════════════════════════════════════════
//  Fractional indexing (base62)
//
//  ทำไมต้องใช้แทน order แบบตัวเลข: แทรกหน้าใหม่ระหว่างสองหน้า = เขียนแถวเดียว
//  ไม่ต้อง renumber พี่น้องทั้งหมด (ซึ่งบนหน้าที่มีลูก 200 หน้า คือ 200 UPDATE
//  และเป็นจุดที่ธุรกรรมชนกัน)
//
//  ── ต่างจากฝั่ง .NET อย่างมีนัยสำคัญ ─────────────────────────────────────
//  ของเดิมเป็น "พอร์ตมือ" ของ npm `fractional-indexing` มาเป็น C# แล้วต้องมี
//  fixture 4,701 เคสคอยพิสูจน์ว่าสองฝั่งให้ผลตรงกันเป๊ะ — เพราะ client สร้าง
//  rank เองด้วย ถ้าสองฝั่งคำนวณต่างกันแม้เคสเดียว ลำดับที่ผู้ใช้เห็นกับที่ฐาน
//  เก็บจะไม่ตรงกัน
//
//  ที่นี่ยังเป็นการเขียนเองอยู่ (ไม่ดึง npm มา) แต่ปัญหา "สองภาษาต้องตรงกัน"
//  หายไปแล้ว — ทั้งเซิร์ฟเวอร์และเบราว์เซอร์เป็น JavaScript เส้นเดียวกันได้
//  fixture เดิมจึงถูกยกมาใช้ต่อในฐานะ "สัญญากับ client" ไม่ใช่ "กันพอร์ตผิด"
//
//  ═════════════════════════════════════════════════════════════════════════
//  ⚠️ อัลกอริทึมนี้ตั้งอยู่บน byte order ทั้งหมด
//
//  คอลัมน์ rank จึงต้องเป็น COLLATE "C" (ดู sql/objects.sql) การเทียบใน JS
//  ปลอดภัยอยู่แล้วเพราะ < > บนสตริงเทียบ UTF-16 code unit ซึ่งตรงกับ byte
//  order สำหรับ ASCII — แต่ **ห้ามใช้ localeCompare** ที่ไหนกับค่านี้
//  ═════════════════════════════════════════════════════════════════════════
//
//  ⚠️ rank ชนกันได้ตามปกติ — สอง client แทรกระหว่างคู่เดียวกันพร้อมกันจะได้ค่า
//     เท่ากัน จึงต้อง ORDER BY rank, id เสมอ (id เป็นตัวตัดสินที่ทุก client
//     เห็นตรงกัน) และห้ามทำ unique index บน (parent_id, rank)
// ═══════════════════════════════════════════════════════════════════════════

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const LAST = DIGITS.at(-1)!;

/** rank แรกสุดเมื่อยังไม่มีพี่น้องเลย */
export const FIRST_RANK = 'a0';

/** ค่าต่ำสุดที่สงวนไว้ ห้ามใช้ ไม่งั้นจะแทรกข้างหน้าไม่ได้อีก */
const SMALLEST = 'A' + ZERO.repeat(26);

export class FractionalIndexError extends Error {}

/** เทียบแบบ ordinal — ไม่ใช่ localeCompare ดูคำเตือนหัวไฟล์ */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const fail = (message: string): never => {
  throw new FractionalIndexError(message);
};

/**
 * สร้าง rank ที่อยู่ระหว่าง a และ b
 * a = null แปลว่าแทรกไว้หน้าสุด, b = null แปลว่าแทรกไว้ท้ายสุด
 */
export function between(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);

  if (a !== null && b !== null && cmp(a, b) >= 0) {
    fail(`rank ต้องเรียงจากน้อยไปมาก แต่ได้ '${a}' >= '${b}'`);
  }

  if (a === null) {
    if (b === null) return FIRST_RANK;

    const integerB = integerPart(b);
    const fractionB = b.slice(integerB.length);

    if (integerB === SMALLEST) return integerB + midpoint('', fractionB);
    if (cmp(integerB, b) < 0) return integerB;

    return decrementInteger(integerB) ?? fail('ลด rank ต่ำกว่านี้ไม่ได้แล้ว');
  }

  if (b === null) {
    const integerA = integerPart(a);
    const fractionA = a.slice(integerA.length);

    return incrementInteger(integerA) ?? integerA + midpoint(fractionA, null);
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);

  if (ia === ib) return ia + midpoint(fa, fb);

  const next = incrementInteger(ia) ?? fail('เพิ่ม rank สูงกว่านี้ไม่ได้แล้ว');

  return cmp(next, b) < 0 ? next : ia + midpoint(fa, null);
}

/**
 * สร้าง rank ต่อเนื่อง n ตัวระหว่าง a และ b
 * ใช้ตอนสร้างหลายหน้าพร้อมกัน (duplicate subtree, import)
 */
export function betweenMany(a: string | null, b: string | null, count: number): string[] {
  if (count <= 0) return [];

  if (b === null) {
    const result: string[] = [];
    let previous = a;
    for (let i = 0; i < count; i++) {
      previous = between(previous, null);
      result.push(previous);
    }
    return result;
  }

  if (a === null) {
    // สร้างถอยหลังจาก b เพื่อให้ระยะห่างสม่ำเสมอ แล้วค่อยกลับด้าน
    const result: string[] = [];
    let next = b;
    for (let i = 0; i < count; i++) {
      next = between(null, next);
      result.push(next);
    }
    return result.reverse();
  }

  // แบ่งครึ่งแบบ binary เพื่อไม่ให้สตริงยาวเร็วเกินไป
  const mid = Math.floor(count / 2);
  const middle = between(a, b);

  return [...betweenMany(a, middle, mid), middle, ...betweenMany(middle, b, count - mid - 1)];
}

// ═══════════════════════════════════════════════════════════════════════════
//  ภายใน
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ตัวอักษรตัวแรกบอกความยาวของ "ส่วนจำนวนเต็ม"
 * a..z = ความยาว 2..27 (ค่าบวก), Z..A = ความยาว 2..27 (ค่าลบ)
 */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return fail(`หัวของ rank ไม่ถูกต้อง: '${head}'`);
}

function integerPart(key: string): string {
  if (key.length === 0) fail('rank ว่าง');

  const length = integerLength(key[0]!);
  if (length > key.length) fail(`rank สั้นเกินไป: '${key}'`);

  return key.slice(0, length);
}

function validateOrderKey(key: string): void {
  if (key === SMALLEST) fail(`rank ต่ำสุดที่สงวนไว้: '${key}'`);

  const integer = integerPart(key);
  const fraction = key.slice(integer.length);

  // เลขศูนย์ท้ายสุดทำให้ค่าไม่ unique ('a01' กับ 'a010' คือค่าเดียวกัน)
  if (fraction.length > 0 && fraction.at(-1) === ZERO) {
    fail(`rank ลงท้ายด้วยศูนย์: '${key}'`);
  }
}

function validateInteger(integer: string): void {
  if (integer.length !== integerLength(integer[0]!)) {
    fail(`ส่วนจำนวนเต็มยาวไม่ถูกต้อง: '${integer}'`);
  }
}

function incrementInteger(x: string): string | null {
  validateInteger(x);

  const head = x[0]!;
  const digits = [...x.slice(1)];
  let carry = true;

  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) + 1;
    if (d === DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS[d]!;
      carry = false;
    }
  }

  if (!carry) return head + digits.join('');

  // ทดล้น — ต้องขยายความยาวของส่วนจำนวนเต็ม
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null; // เต็มเพดานแล้ว

  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();

  return nextHead + digits.join('');
}

function decrementInteger(x: string): string | null {
  validateInteger(x);

  const head = x[0]!;
  const digits = [...x.slice(1)];
  let borrow = true;

  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) - 1;
    if (d === -1) {
      digits[i] = LAST;
    } else {
      digits[i] = DIGITS[d]!;
      borrow = false;
    }
  }

  if (!borrow) return head + digits.join('');

  if (head === 'a') return 'Z' + LAST;
  if (head === 'A') return null; // ถึงพื้นแล้ว

  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < 'Z') digits.push(LAST);
  else digits.pop();

  return prevHead + digits.join('');
}

/** ค่ากึ่งกลางของส่วนทศนิยม (a < b เสมอ, b = null คือไม่มีขอบบน) */
function midpoint(a: string, b: string | null): string {
  if (b !== null && cmp(a, b) >= 0) fail(`'${a}' >= '${b}'`);

  if ((a.length > 0 && a.at(-1) === ZERO) || (b !== null && b.length > 0 && b.at(-1) === ZERO)) {
    fail('ส่วนทศนิยมลงท้ายด้วยศูนย์');
  }

  if (b !== null) {
    // ตัดส่วนหน้าที่เหมือนกันออกก่อน
    let n = 0;
    while (n < b.length && (n < a.length ? a[n] : ZERO) === b[n]) n++;

    if (n > 0) return b.slice(0, n) + midpoint(n < a.length ? a.slice(n) : '', b.slice(n));
  }

  const digitA = a.length > 0 ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;

  if (digitB - digitA > 1) {
    // ⚠️ Math.round ปัดครึ่งขึ้นเสมอ ซึ่งตรงกับ MidpointRounding.AwayFromZero
    //    ของฝั่ง C# เพราะผลรวมเป็นค่าบวกเสมอ
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }

  // เลขตัวแรกติดกัน — ต้องลงไปหลักถัดไป
  if (b !== null && b.length > 1) return b.slice(0, 1);

  return DIGITS[digitA]! + midpoint(a.length > 0 ? a.slice(1) : '', null);
}

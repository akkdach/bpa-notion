using Microsoft.EntityFrameworkCore;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  ทางเดียวที่ควรเปิด transaction ในโปรเจกต์นี้
//
//  ⚠️ ปัญหาที่แก้: PersistenceConfiguration เปิด EnableRetryOnFailure ไว้
//     (จำเป็น — connection ไป Postgres ใน container หลุดได้) แต่ทันทีที่เปิด
//     retry strategy การเรียก BeginTransactionAsync() ตรง ๆ จะ throw:
//
//       "The configured execution strategy 'NpgsqlRetryingExecutionStrategy'
//        does not support user-initiated transactions."
//
//     เหตุผลที่ EF ห้าม: ถ้า retry เกิดขึ้นกลาง transaction มันต้องเล่นซ้ำ
//     "ทั้งบล็อก" ไม่ใช่แค่คำสั่งที่ล้ม แต่ EF ไม่รู้ว่าบล็อกเริ่มที่ไหน
//     เว้นแต่เราบอกด้วย ExecuteAsync
//
//     เรื่องนี้สำคัญกว่าที่คิด เพราะงานที่ต้อง atomic ในระบบนี้มีเยอะ:
//     rotate refresh token, ย้าย subtree, snapshot + prune, dual relation
//
//  ⚠️ work ต้อง idempotent-safe: มันถูกเรียกซ้ำได้ถ้า connection หลุด
//     ห้ามมี side effect นอกฐานข้อมูล (ส่งอีเมล, เขียนไฟล์) อยู่ข้างใน
// ═══════════════════════════════════════════════════════════════════════════
public static class TransactionExtensions
{
    public static Task InTransactionAsync(
        this AppDbContext db,
        Func<CancellationToken, Task> work,
        CancellationToken ct = default)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await work(ct);
            await transaction.CommitAsync(ct);
        });

    public static Task<T> InTransactionAsync<T>(
        this AppDbContext db,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct = default)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var result = await work(ct);
            await transaction.CommitAsync(ct);
            return result;
        });
}

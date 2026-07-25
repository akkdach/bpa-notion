using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace ProjectManagementAPI.Data;

// ═══════════════════════════════════════════════════════════════════════════
//  IScopedSql — ทางเดียวที่ raw SQL ควรวิ่งผ่าน
//
//  ⚠️ global query filter ของ EF "ไม่มีผล" กับ raw SQL
//     เรามี raw SQL เยอะโดยจำเป็น: PGroonga (&@~ ที่ EF ไม่รู้จัก), view query
//     ที่ประกอบจาก filter/sort ของผู้ใช้, subtree update ด้วย ancestor_ids @>
//
//     แปลว่าทุก query ต้องเขียน `AND workspace_id = @__ws` เองทุกครั้ง ซึ่งเป็น
//     สิ่งที่ลืมได้ และเมื่อลืมก็ไม่มีอะไรฟ้อง — จนกว่าลูกค้าเห็นข้อมูลของ
//     ลูกค้าอีกราย
//
//     ตัวนี้จึงบังคับ: parameter @__ws ถูกใส่ให้เสมอจาก ITenantContext และถ้า
//     SQL ที่ส่งมาไม่มีการอ้าง @__ws เลย จะ throw ทันทีตอน dev
// ═══════════════════════════════════════════════════════════════════════════
public interface IScopedSql
{
    /// <summary>ชื่อ parameter ที่ถูกใส่ให้อัตโนมัติ — SQL ต้องอ้างถึงตัวนี้</summary>
    const string WorkspaceParam = "__ws";

    Task<int> ExecuteAsync(
        string sql,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default);

    Task<List<T>> QueryAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default);

    Task<T?> QuerySingleAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default);
}

public class ScopedSql(AppDbContext db, ITenantContext tenant, IHostEnvironment env) : IScopedSql
{
    public async Task<int> ExecuteAsync(
        string sql,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default)
    {
        await using var command = await PrepareAsync(sql, parameters, ct);
        return await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<List<T>> QueryAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default)
    {
        await using var command = await PrepareAsync(sql, parameters, ct);
        await using var reader = await command.ExecuteReaderAsync(ct);

        var results = new List<T>();
        while (await reader.ReadAsync(ct))
        {
            results.Add(map(reader));
        }
        return results;
    }

    public async Task<T?> QuerySingleAsync<T>(
        string sql,
        Func<NpgsqlDataReader, T> map,
        Action<NpgsqlParameterCollection>? parameters = null,
        CancellationToken ct = default)
    {
        await using var command = await PrepareAsync(sql, parameters, ct);
        await using var reader = await command.ExecuteReaderAsync(ct);

        return await reader.ReadAsync(ct) ? map(reader) : default;
    }

    private async Task<NpgsqlCommand> PrepareAsync(
        string sql,
        Action<NpgsqlParameterCollection>? parameters,
        CancellationToken ct)
    {
        // ─────────────────────────────────────────────────────────────────
        //  ตรวจตอน dev ว่า SQL อ้าง @__ws จริง
        //
        //  ทำเฉพาะ Development เพราะเป็นการช่วยตอนเขียนโค้ด ไม่ใช่ security
        //  boundary (ตัว boundary จริงคือ composite FK ในฐานข้อมูล)
        // ─────────────────────────────────────────────────────────────────
        if (env.IsDevelopment() &&
            !sql.Contains($"@{IScopedSql.WorkspaceParam}", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"raw SQL ไม่ได้อ้าง @{IScopedSql.WorkspaceParam} เลย — " +
                "ทุก query ที่วิ่งผ่าน IScopedSql ต้องจำกัดขอบเขตด้วย workspace_id " +
                $"เช่น `WHERE workspace_id = @{IScopedSql.WorkspaceParam}`\n\nSQL:\n{sql}");
        }

        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        var command = connection.CreateCommand();
        command.CommandText = sql;

        // ผูก transaction ของ EF ถ้ามี — ไม่งั้น raw SQL จะวิ่งนอก transaction
        // แล้วการเขียนแบบหลายขั้น (เช่น ย้าย subtree) จะไม่ atomic
        var transaction = db.Database.CurrentTransaction;
        if (transaction is not null)
        {
            command.Transaction = (NpgsqlTransaction)transaction.GetDbTransaction();
        }

        command.Parameters.Add(new NpgsqlParameter(
            IScopedSql.WorkspaceParam, NpgsqlDbType.Uuid)
        {
            Value = tenant.RequireWorkspaceId()
        });

        parameters?.Invoke(command.Parameters);

        return command;
    }
}

using Npgsql;
using NpgsqlTypes;
using ProjectManagementAPI.Data;
using ProjectManagementAPI.Repositories.Abstractions;

namespace ProjectManagementAPI.Repositories;

// ═══════════════════════════════════════════════════════════════════════════
//  SearchRepository — PGroonga
//
//  ต้องเป็น raw SQL: `&@~`, pgroonga_score() และ pgroonga_snippet_html()
//  ไม่มีทางเขียนผ่าน EF ได้เลย
//
//  ⚠️ raw SQL ไม่ผ่าน global query filter จึงต้องเขียนเงื่อนไขเองครบทั้งสามชั้น:
//     workspace_id (tenant), deleted_at (soft delete) และ access_root_id (สิทธิ์)
//     ลืมข้อใดข้อหนึ่ง = ข้อมูลรั่วโดยไม่มีอะไรฟ้อง
// ═══════════════════════════════════════════════════════════════════════════
public class SearchRepository(IScopedSql sql) : ISearchRepository
{
    public Task<List<SearchHit>> SearchAsync(
        string query,
        IReadOnlyList<Guid> visibleAccessRoots,
        IReadOnlyList<string> statuses,
        int limit,
        CancellationToken ct = default)
        // ─────────────────────────────────────────────────────────────────
        //  pgroonga_query_escape ทำให้คำค้นของผู้ใช้ถูกอ่านเป็นข้อความ ไม่ใช่ไวยากรณ์
        //
        //  `&@~` รับ query syntax ของ Groonga (`+ - ( ) " *` และ OR) ถ้าปล่อยคำค้น
        //  ดิบเข้าไป ผู้ใช้พิมพ์วงเล็บเดียวก็ทำให้ query throw ทั้งคำขอ — และ AI ที่
        //  ได้ error กลับไปมักลองซ้ำแบบเดิม ไม่ได้เดาว่าต้อง escape เอง
        //
        //  เลือก escape ด้วยฟังก์ชันของ PGroonga เองไม่ใช่เขียนกฎใน C# เพราะกฎ
        //  การ escape เป็นของ Groonga ถ้าลอกมาแล้วคลาดไปตัวเดียวจะได้ผลค้นที่ผิด
        //  แบบเงียบ ๆ ไม่ใช่ error
        //
        //  ⚠️ มันไม่ escape คำว่า OR — ผู้ใช้พิมพ์ OR ยังได้ความหมาย OR อยู่
        //     ยอมรับได้ เพราะมันไม่ทำให้ query พัง และเป็นพฤติกรรมที่อธิบายได้
        //
        //  ⚠️ ห้ามเรียงด้วย score เพียว ๆ — หน้าที่แก้ล่าสุดควรมาก่อนเมื่อคะแนนเท่ากัน
        //     และต้องมี id ปิดท้ายเพื่อให้ลำดับคงที่ (paging ในอนาคตต้องพึ่งข้อนี้)
        // ─────────────────────────────────────────────────────────────────
        => sql.QueryAsync("""
            SELECT s.page_id,
                   p.parent_id,
                   p.title,
                   p.icon,
                   p.status,
                   COALESCE(
                       (pgroonga_snippet_html(
                           s.body_text,
                           pgroonga_query_extract_keywords(pgroonga_query_escape(@q))))[1],
                       '') AS snippet,
                   pgroonga_score(s.tableoid, s.ctid) AS score,
                   p.updated_at
              FROM page_searches s
              JOIN pages p
                ON p.workspace_id = s.workspace_id
               AND p.id = s.page_id
             WHERE s.workspace_id = @__ws
               AND s.access_root_id = ANY(@roots)
               AND p.deleted_at IS NULL
               AND s.search_text &@~ pgroonga_query_escape(@q)
               AND (cardinality(@statuses) = 0 OR p.status = ANY(@statuses))
             ORDER BY score DESC, p.updated_at DESC, s.page_id
             LIMIT @limit
            """,
            reader => new SearchHit(
                Id: reader.GetGuid(0),
                ParentId: reader.IsDBNull(1) ? null : reader.GetGuid(1),
                Title: reader.GetString(2),
                Icon: reader.IsDBNull(3) ? null : reader.GetString(3),
                Status: reader.IsDBNull(4) ? null : reader.GetString(4),
                Snippet: reader.GetString(5),
                Score: reader.GetDouble(6),
                UpdatedAt: reader.GetFieldValue<DateTimeOffset>(7)),
            p =>
            {
                p.Add(new NpgsqlParameter("q", NpgsqlDbType.Text) { Value = query });
                p.Add(new NpgsqlParameter("roots", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
                {
                    Value = visibleAccessRoots.ToArray()
                });
                p.Add(new NpgsqlParameter("statuses", NpgsqlDbType.Array | NpgsqlDbType.Text)
                {
                    Value = statuses.ToArray()
                });
                p.Add(new NpgsqlParameter("limit", NpgsqlDbType.Integer) { Value = limit });
            },
            ct);
}

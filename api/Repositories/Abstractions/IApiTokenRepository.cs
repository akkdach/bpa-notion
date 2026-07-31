using ProjectManagementAPI.Domain;
using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Repositories.Abstractions;

public interface IApiTokenRepository
{
    /// <summary>
    /// หา token จาก hash พร้อมข้อมูลที่ต้องใช้ยืนยันตัวตนในคำขอเดียว
    /// </summary>
    /// <remarks>
    /// ⚠️ วิ่งก่อนที่ระบบจะรู้ว่า workspace ไหน จึงข้าม tenant filter โดยเจตนา
    ///    (ตัว token เป็นคนบอกว่า workspace ไหน ไม่ใช่ header)
    ///
    ///    คืน null ทั้งกรณี "ไม่มีใบนี้" และ "ใบนี้ถูกเพิกถอน/หมดอายุ" —
    ///    ผู้เรียกไม่ต้องแยก เพราะทั้งสองกรณีตอบ 401 เหมือนกัน และการแยกให้
    ///    ผู้เรียกรู้ว่า "มีใบนี้อยู่จริงแต่ถูกเพิกถอน" คือการยืนยันให้คนที่ขโมย
    ///    token ไปว่าเขาได้ของจริงมา
    /// </remarks>
    Task<ApiTokenPrincipal?> ResolveAsync(string tokenHash, CancellationToken ct = default);

    /// <summary>บันทึกว่าใช้ล่าสุดเมื่อไหร่ — หน่วงไว้ ไม่เขียนทุก request</summary>
    Task TouchAsync(Guid tokenId, CancellationToken ct = default);

    Task<ApiToken> AddAsync(ApiToken token, CancellationToken ct = default);

    /// <summary>token ทั้งหมดของ workspace ปัจจุบัน รวมที่เพิกถอนแล้ว</summary>
    Task<List<ApiToken>> ListAsync(Guid workspaceId, CancellationToken ct = default);

    /// <summary>คืน false เมื่อไม่พบใบนั้นใน workspace นี้ (หรือเพิกถอนไปแล้ว)</summary>
    Task<bool> RevokeAsync(Guid workspaceId, Guid tokenId, CancellationToken ct = default);

    /// <summary>บัญชี agent ของ workspace นี้ — null ถ้ายังไม่มี</summary>
    Task<User?> FindAgentAsync(Guid workspaceId, CancellationToken ct = default);
}

/// <param name="Role">สิทธิ์ของบัญชีใน workspace นั้น ณ ตอนที่ตรวจ</param>
public record ApiTokenPrincipal(
    Guid TokenId,
    Guid WorkspaceId,
    Guid UserId,
    WorkspaceRole Role,
    DateTimeOffset? LastUsedAt);

using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface IApiTokenService
{
    /// <summary>
    /// ออก token ใหม่สำหรับ workspace ปัจจุบัน — owner/admin เท่านั้น
    /// </summary>
    /// <remarks>
    /// สร้างบัญชี agent ให้อัตโนมัติถ้ายังไม่มี ผู้ใช้จึงไม่ต้องรู้ว่ามันมีอยู่
    /// — สิ่งที่ลูกค้าเห็นคือ "กดสร้าง token" ไม่ใช่ "ไปสร้างบัญชีบอทก่อน"
    ///
    /// ⚠️ ค่าจริงของ token คืนกลับครั้งเดียวตรงนี้ที่เดียว
    /// </remarks>
    Task<Result<CreatedApiTokenDto>> CreateAsync(
        CreateApiTokenRequest request, CancellationToken ct = default);

    /// <summary>token ทั้งหมดของ workspace ปัจจุบัน รวมที่เพิกถอน/หมดอายุแล้ว</summary>
    Task<Result<IReadOnlyList<ApiTokenDto>>> ListAsync(CancellationToken ct = default);

    /// <summary>เพิกถอนใบเดียว — มีผลทันทีกับคำขอถัดไป</summary>
    Task<Result> RevokeAsync(Guid tokenId, CancellationToken ct = default);
}

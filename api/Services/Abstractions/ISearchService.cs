using ProjectManagementAPI.DTOs;
using ProjectManagementAPI.Helpers;

namespace ProjectManagementAPI.Services.Abstractions;

public interface ISearchService
{
    /// <summary>
    /// ค้นหาหน้าใน workspace ปัจจุบัน — กรองตามสิทธิ์แล้ว
    /// </summary>
    /// <param name="status">
    /// กรองสถานะงาน: todo / doing / done — null หรือว่าง = ไม่กรอง
    /// ค่าที่ไม่รู้จักคืน 400 ไม่ใช่ผลลัพธ์ว่าง เพื่อให้ผู้เรียกรู้ว่าพิมพ์ผิด
    /// </param>
    Task<Result<SearchResultDto>> SearchAsync(
        string query, string? status, int? limit, CancellationToken ct = default);
}

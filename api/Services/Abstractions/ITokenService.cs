using ProjectManagementAPI.Models;

namespace ProjectManagementAPI.Services.Abstractions;

public interface ITokenService
{
    /// <summary>
    /// access token — อายุสั้น ไม่มี workspace อยู่ในนั้น
    ///
    /// workspace มาจาก header X-Workspace-Id แล้วตรวจสมาชิกภาพทุก request
    /// (ดูเหตุผลใน ITenantContext) การไม่ฝัง workspace ใน token ทำให้การถอด
    /// คนออกจาก workspace มีผลทันที ไม่ต้องรอ token หมดอายุ
    /// </summary>
    AccessToken CreateAccessToken(User user);

    /// <summary>refresh token — คืนค่า plaintext (ส่งให้ client ครั้งเดียว) และ hash (เก็บลงฐาน)</summary>
    RefreshTokenPair CreateRefreshToken();

    /// <summary>hash ของ token ที่ client ส่งกลับมา เพื่อ lookup ในฐาน</summary>
    string HashRefreshToken(string token);

    TimeSpan RefreshTokenLifetime { get; }
}

public record AccessToken(string Token, DateTimeOffset ExpiresAt);

public record RefreshTokenPair(string Token, string TokenHash, DateTimeOffset ExpiresAt);

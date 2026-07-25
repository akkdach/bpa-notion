using ProjectManagementAPI.Services.Abstractions;

namespace ProjectManagementAPI.Services;

// ═══════════════════════════════════════════════════════════════════════════
//  bcrypt
//
//  ใช้ EnhancedHashPassword ซึ่ง pre-hash ด้วย SHA-384 ก่อน แก้ข้อจำกัดของ
//  bcrypt ที่ตัดรหัสผ่านทิ้งหลังไบต์ที่ 72 — ถ้าไม่ทำ รหัสผ่านยาว ๆ (หรือ
//  passphrase ภาษาไทยซึ่งกินไบต์ละ 3) จะถูกตัดเงียบ ๆ แล้วรหัสที่ต่างกัน
//  กลายเป็นรหัสเดียวกัน
//
//  ⚠️ Enhanced กับปกติใช้ร่วมกันไม่ได้ — hash ที่สร้างด้วย EnhancedHashPassword
//     ต้องเทียบด้วย EnhancedVerify เท่านั้น
// ═══════════════════════════════════════════════════════════════════════════
public class PasswordHasher(ILogger<PasswordHasher> logger) : IPasswordHasher
{
    /// <summary>
    /// 12 รอบ ≈ 250-400ms บนเครื่องปัจจุบัน — ช้าพอที่จะกวน brute force
    /// แต่ไม่ช้าพอให้ login รู้สึกหน่วง
    /// </summary>
    private const int WorkFactor = 12;

    public string Hash(string password)
        => BCrypt.Net.BCrypt.EnhancedHashPassword(password, WorkFactor);

    public bool Verify(string password, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.EnhancedVerify(password, hash);
        }
        catch (Exception ex) when (ex is BCrypt.Net.SaltParseException or ArgumentException)
        {
            // hash ในฐานเสียรูป (แก้มือ / migrate ผิด / ข้อมูลจากระบบเก่า)
            // ถือว่ารหัสผ่านไม่ถูก — ไม่ throw เพราะจะกลายเป็น 500 ที่บอกใบ้ว่า
            // อีเมลนี้มีอยู่จริงในระบบ
            logger.LogWarning(ex, "password hash ในฐานข้อมูลเสียรูป");
            return false;
        }
    }
}

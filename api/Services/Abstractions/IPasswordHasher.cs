namespace ProjectManagementAPI.Services.Abstractions;

public interface IPasswordHasher
{
    string Hash(string password);

    /// <summary>เทียบรหัสผ่าน — ต้องไม่ throw แม้ hash ในฐานจะเสียรูป</summary>
    bool Verify(string password, string hash);
}

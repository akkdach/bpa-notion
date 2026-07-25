using System.Text.Json;
using System.Text.Json.Serialization;
using ProjectManagementAPI.Filters;

namespace ProjectManagementAPI.Configurations;

// ═══════════════════════════════════════════════════════════════════════════
//  Controllers + JSON serialisation
// ═══════════════════════════════════════════════════════════════════════════
public static class ApiControllersConfiguration
{
    public static IServiceCollection AddApiControllers(this IServiceCollection services)
    {
        services
            .AddControllers(options =>
            {
                // error shaping ที่เดียว — ไม่ใช่ try/catch กระจายใน controller
                options.Filters.Add<ApiExceptionFilter>();

                // validation ที่เดียว — ไม่ใช่ if (!ModelState.IsValid) ทุก action
                options.Filters.Add<ValidationFilter>();
            })
            .ConfigureApiBehaviorOptions(options =>
            {
                // ปิด ProblemDetails อัตโนมัติของ [ApiController]
                // ไม่งั้น error ของ model binding จะมีหน้าตาคนละแบบกับ
                // ApiResponse ที่ endpoint อื่นตอบ ทำให้ฝั่ง client ต้องรองรับสองแบบ
                options.SuppressModelStateInvalidFilter = true;
            })
            .AddJsonOptions(options =>
            {
                var json = options.JsonSerializerOptions;

                // camelCase ทั้ง property และ dictionary key ให้ตรงกับฝั่ง TS
                json.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
                json.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;

                // enum ส่งเป็น string — ตัวเลขทำให้ค่าที่ client เห็นเปลี่ยน
                // ความหมายเงียบ ๆ เวลามีคนแทรก enum member ตรงกลาง
                json.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

                // ตัด null ออกจาก response ให้ payload เล็กลง
                json.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
            });

        services.AddEndpointsApiExplorer();

        return services;
    }
}

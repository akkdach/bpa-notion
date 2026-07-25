/** ตรงกับ payload ของ GET /api/v1/health (ดู api/Controllers/HealthCheckController.cs) */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy'
  timestamp: string
  database: {
    canConnect: boolean
    latencyMs: number
    serverVersion?: string
    extensions: string[]
    missingExtensions: string[]
    error?: string
  }
}

import { Bot, Building2, Palette, Users } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { AppearanceSettings, SettingsLayout, type SettingsSection } from '@/features/settings'
import {
  AiConnectionSettings, MemberSettings, WorkspaceSettings,
  useAddMember, useApiTokens, useCreateApiToken, useCurrentWorkspace, useMembers,
  useRemoveMember, useRevokeApiToken, useUpdateMemberRole, useUpdateWorkspace,
} from '@/features/workspace'

// ═══════════════════════════════════════════════════════════════════════════
//  SettingsPage — ประกอบ route เข้าด้วยกัน ไม่มี logic ของตัวเอง
//
//  หมวดอยู่ใน URL (/settings/members) ไม่ใช่ใน state — ผู้ใช้จึงกดปุ่มย้อนกลับ
//  ของเบราว์เซอร์ได้ตามที่คาด และส่งลิงก์หน้าที่กำลังดูให้คนอื่นได้
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SECTION = 'workspace'

export function SettingsPage() {
  const { section } = useParams<{ section: string }>()
  const navigate = useNavigate()

  const { user, currentWorkspace } = useAuth()

  const workspace = useCurrentWorkspace()
  const members = useMembers()
  const updateWorkspace = useUpdateWorkspace()
  const addMember = useAddMember()
  const updateRole = useUpdateMemberRole()
  const removeMember = useRemoveMember()
  const apiTokens = useApiTokens()
  const createToken = useCreateApiToken()
  const revokeToken = useRevokeApiToken()

  const role = currentWorkspace?.role
  const canManage = role === 'owner' || role === 'admin'
  const active = section ?? DEFAULT_SECTION

  const sections: SettingsSection[] = [
    { id: 'workspace', label: 'workspace', icon: <Building2 className="size-4" aria-hidden /> },
    { id: 'members', label: 'สมาชิก', icon: <Users className="size-4" aria-hidden /> },
    { id: 'ai', label: 'การเชื่อมต่อ AI', icon: <Bot className="size-4" aria-hidden /> },
    { id: 'appearance', label: 'การแสดงผล', icon: <Palette className="size-4" aria-hidden /> },
  ]

  return (
    <SettingsLayout
      sections={sections}
      activeId={active}
      onSelect={(id) => void navigate(`/settings/${id}`)}
      onClose={() => void navigate('/')}
    >
      {active === 'workspace' && (
        <WorkspaceSettings
          workspace={workspace.data}
          isLoading={workspace.isLoading}
          error={workspace.error}
          canEdit={canManage}
          isSaving={updateWorkspace.isPending}
          onSave={(input) => updateWorkspace.mutateAsync(input).then(() => undefined)}
        />
      )}

      {active === 'members' && (
        <MemberSettings
          members={members.data ?? []}
          currentUserId={user?.id ?? ''}
          isLoading={members.isLoading}
          error={members.error}
          canManage={canManage}
          isBusy={addMember.isPending || updateRole.isPending || removeMember.isPending}
          onAdd={(input) => addMember.mutateAsync(input).then(() => undefined)}
          onChangeRole={(userId, newRole) =>
            updateRole.mutateAsync({ userId, role: newRole }).then(() => undefined)}
          onRemove={(userId) => removeMember.mutateAsync(userId).then(() => undefined)}
        />
      )}

      {active === 'ai' && (
        <AiConnectionSettings
          tokens={apiTokens.data ?? []}
          isLoading={apiTokens.isLoading}
          error={apiTokens.error}
          canManage={canManage}
          isBusy={createToken.isPending || revokeToken.isPending}
          onCreate={(input) => createToken.mutateAsync(input)}
          onRevoke={(tokenId) => revokeToken.mutateAsync(tokenId).then(() => undefined)}
        />
      )}

      {active === 'appearance' && <AppearanceSettings />}
    </SettingsLayout>
  )
}

import { useContext } from 'react'
import { AuthContext } from '../AuthProvider'

export function useAuth() {
  const context = useContext(AuthContext)

  if (context === null) {
    throw new Error('useAuth ต้องอยู่ภายใต้ <AuthProvider>')
  }

  return context
}

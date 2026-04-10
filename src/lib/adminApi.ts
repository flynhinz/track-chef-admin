import { getToken } from './supabase'
const FUNCTION_URL = import.meta.env.VITE_SUPABASE_ADMIN_FUNCTION_URL
async function callAdmin(action: string, payload?: Record<string, unknown>) {
  const token = await getToken()
  const res = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ action, payload }) })
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`)
  return res.json()
}
export const adminApi = {
  getAllTenants: () => callAdmin('all_tenants'),
  getAllUsers: (tenantId?: string) => callAdmin('all_users', tenantId ? { tenant_id: tenantId } : {}),
  deleteProfile: (profileId: string) => callAdmin('delete_profile', { profile_id: profileId }),
  deleteTenant: (tenantId: string) => callAdmin('delete_tenant', { tenant_id: tenantId }),
}

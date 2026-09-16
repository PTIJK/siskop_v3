export interface TenantMembershipSummary {
  tenantId: string
  membershipId: string
  name: string
  slug: string
  logoUrl: string | null
  roleName: string
}
export interface TenantMembershipPage {
  items: TenantMembershipSummary[]
  total: number
  filteredTotal: number
  page: number
}
export interface StaffTenantRedirect {
  next: 'tenant_redirect'
  /** Retained for clients using the original browser-bound handoff. */
  startUrl: string
  /** Present when the backend supports direct form handoff. */
  handoff?: { attempt: string }
}
export type StaffLoginResult =
  | StaffTenantRedirect
  | { next: 'tenant_selection'; eligibleCount: number }
  | { next: 'no_access' }
  | { next: 'dashboard'; session: import('./user.js').LoginResponse }
  | { next: 'checkout'; order: import('./onboarding.js').OnboardingStatus }
export interface TenantAccessConfig {
  enabled: boolean
  switching: boolean
  centralUrl: string
}
export interface MembershipInvitationResponse {
  invitationUrl: string
  expiresAt: string
}

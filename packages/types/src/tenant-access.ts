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
export type StaffLoginResult =
  | { next: 'tenant_redirect'; startUrl: string }
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

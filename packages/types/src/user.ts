export type UserRole = "super_admin" | "tenant_admin" | "accountant" | "member";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  phone: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthClaims {
  userId: string;
  tenantId: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

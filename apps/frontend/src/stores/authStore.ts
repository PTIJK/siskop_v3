import { create } from 'zustand';
import { AuthUser, Tenant } from '@siskop/shared';

interface AuthState {
  user: AuthUser | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: AuthUser, tenant: Tenant) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: true,
  setAuth: (user, tenant) => set({ user, tenant, isAuthenticated: true, isLoading: false }),
  clearAuth: () => set({ user: null, tenant: null, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));

import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import api from '../lib/api';

export function useAuth() {
  const { user, tenant, isAuthenticated, isLoading, setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const res = await api.get('/api/auth/me');
        setAuth(res.data.data.user, res.data.data.tenant);
      } catch {
        clearAuth();
      }
    };
    restoreSession();
    // Runs once on mount only; setAuth/clearAuth are stable Zustand actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post('/api/auth/login', { email, password });
    setAuth(res.data.data.user, res.data.data.tenant);
    return res.data.data;
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    clearAuth();
    window.location.href = '/login';
  };

  return { user, tenant, isAuthenticated, isLoading, login, logout };
}

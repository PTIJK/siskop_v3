import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const api = axios.create({
  // Empty string → relative URLs → Vite proxy adds the correct Host header.
  // In production set VITE_API_URL to the absolute API origin.
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];

const processQueue = (error: Error | null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(undefined)));
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes('/api/auth/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(original));
      }

      original._retry = true;
      isRefreshing = true;

      try {
        await api.post('/api/auth/refresh');
        processQueue(null);
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError as Error);
        useAuthStore.getState().clearAuth();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

/** True when an API error response is a 403 FEATURE_NOT_ENTITLED (package doesn't include this feature). */
export function isFeatureNotEntitled(err: unknown): boolean {
  const axiosErr = err as { response?: { data?: { error?: { code?: string } } } };
  return axiosErr?.response?.data?.error?.code === 'FEATURE_NOT_ENTITLED';
}

/** Extracts the backend's Indonesian error message from an API error, falling back if absent. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message ?? fallback;
}

export default api;

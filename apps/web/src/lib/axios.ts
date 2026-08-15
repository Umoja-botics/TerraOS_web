import axios from 'axios';
import { useAuthStore } from '@/store/authStore';

export const api = axios.create({
  // Same-origin by default: works from localhost, a LAN address and production.
  baseURL: import.meta.env.VITE_API_URL ?? '',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('terra_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      // Vider le store Zustand + localStorage sans rechargement dur.
      // ProtectedRoute détecte token=null et redirige vers /login via React Router.
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  },
);

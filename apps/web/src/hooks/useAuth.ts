import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/axios';
import type { AuthResponse, LoginDto } from '@terra-os/types';

export function useAuth() {
  const { token, user, setAuth, logout } = useAuthStore();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: (dto: LoginDto) =>
      api.post<AuthResponse>('/api/v1/auth/login', dto).then((r) => r.data),
    onSuccess: (data) => {
      setAuth(data.accessToken, data.user);
    },
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return {
    token,
    user,
    isAuthenticated: !!token,
    login: loginMutation.mutate,
    loginError: loginMutation.error,
    isLoggingIn: loginMutation.isPending,
    logout: handleLogout,
  };
}

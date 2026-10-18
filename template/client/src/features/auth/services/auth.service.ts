import { apiClient } from '@/lib/api/axios.config';
import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';

import type { ApiResponse } from '@/lib/api/api.types';
import type { IUser, ILoginRequest, IRegisterRequest } from '../types/auth.types';

interface AuthResponse {
  user: IUser;
}

class AuthService {
  async register(data: IRegisterRequest): Promise<AuthResponse> {
    // skipLimitToast: RegisterForm shows a rate-limit answer inline instead.
    const response = await apiClient.post<ApiResponse<AuthResponse>>(
      API_ENDPOINTS.AUTH.REGISTER,
      data,
      { skipLimitToast: true }
    );
    return response.data.data;
  }

  async login(data: ILoginRequest): Promise<AuthResponse> {
    // skipLimitToast: LoginForm shows a rate-limit or lock answer inline instead.
    const response = await apiClient.post<ApiResponse<AuthResponse>>(
      API_ENDPOINTS.AUTH.LOGIN,
      data,
      { skipLimitToast: true }
    );
    return response.data.data;
  }

  async logout(): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.LOGOUT);
  }

  async getMe(): Promise<IUser> {
    const response = await apiClient.get<ApiResponse<IUser>>(
      API_ENDPOINTS.AUTH.ME
    );
    return response.data.data;
  }

  async forgotPassword(email: string): Promise<void> {
    // skipLimitToast: ForgotPasswordForm shows a rate-limit answer inline instead.
    await apiClient.post(API_ENDPOINTS.AUTH.FORGOT_PASSWORD, { email }, { skipLimitToast: true });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.RESET_PASSWORD, { token, newPassword });
  }
}

export const authService = new AuthService();

import { apiClient } from '@/lib/api/axios.config';
import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';

import type { ApiResponse } from '@/lib/api/api.types';
import type { IUser, ILoginRequest, IRegisterRequest } from '../types/auth.types';

interface AuthResponse {
  user: IUser;
}

class AuthService {
  async register(data: IRegisterRequest): Promise<AuthResponse> {
    const response = await apiClient.post<ApiResponse<AuthResponse>>(
      API_ENDPOINTS.AUTH.REGISTER,
      data
    );
    return response.data.data;
  }

  async login(data: ILoginRequest): Promise<AuthResponse> {
    const response = await apiClient.post<ApiResponse<AuthResponse>>(
      API_ENDPOINTS.AUTH.LOGIN,
      data
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
    await apiClient.post(API_ENDPOINTS.AUTH.FORGOT_PASSWORD, { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.RESET_PASSWORD, { token, newPassword });
  }
}

export const authService = new AuthService();

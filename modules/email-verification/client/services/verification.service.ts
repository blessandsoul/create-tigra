import { apiClient } from '@/lib/api/axios.config';
import { API_ENDPOINTS } from '@/lib/constants/api-endpoints';

import type { ApiResponse } from '@/lib/api/api.types';
import type { IUser } from '../types/auth.types';

interface AuthResponse {
  user: IUser;
}

class VerificationService {
  async sendVerification(email: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.AUTH.SEND_VERIFICATION, { email });
  }

  async verifyAccount(token: string): Promise<AuthResponse> {
    const response = await apiClient.post<ApiResponse<AuthResponse>>(
      API_ENDPOINTS.AUTH.VERIFY_ACCOUNT,
      { token },
    );
    return response.data.data;
  }
}

export const verificationService = new VerificationService();

export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** Admin ban switch: false = deactivated by an admin. */
  isActive: boolean;
  /** ISO timestamp of email verification; null while unverified. */
  emailVerifiedAt: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'USER' | 'ADMIN';

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IRegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface IAuthState {
  user: IUser | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  isLoggingOut: boolean;
}

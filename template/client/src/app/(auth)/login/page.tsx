import type React from 'react';

import { LoginForm } from '@/features/auth/components/LoginForm';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage(): React.ReactElement {
  return <LoginForm />;
}

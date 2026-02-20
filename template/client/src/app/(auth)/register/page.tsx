import type React from 'react';

import { RegisterForm } from '@/features/auth/components/RegisterForm';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create account',
};

export default function RegisterPage(): React.ReactElement {
  return <RegisterForm />;
}

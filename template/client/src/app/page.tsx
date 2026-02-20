'use client';

import type React from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSelector } from '@/store/hooks';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { APP_NAME } from '@/lib/constants/app.constants';

export default function WelcomePage(): React.ReactElement {
  const { user } = useAppSelector((state) => state.auth);
  const { logout, isLoggingOut } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-foreground">
          {APP_NAME}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          disabled={isLoggingOut}
          className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center">
        {user ? (
          <h1 className="text-3xl font-light tracking-tight text-foreground">
            Welcome, {user.firstName}
          </h1>
        ) : (
          <Skeleton className="h-9 w-64" />
        )}
      </main>
    </div>
  );
}

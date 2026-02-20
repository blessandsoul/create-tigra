import type React from 'react';

import Link from 'next/link';

import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants/routes';

export default function NotFound(): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
      <FileQuestion className="mb-4 h-16 w-16 text-muted-foreground" />
      <h1 className="mb-2 text-3xl font-bold">Page not found</h1>
      <p className="mb-6 text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild>
        <Link href={ROUTES.HOME}>Go home</Link>
      </Button>
    </div>
  );
}

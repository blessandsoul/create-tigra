import type React from 'react';

import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AppLink } from './AppLink';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

export const EmptyState = ({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps): React.ReactElement => (
  <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
    <FileQuestion className="mb-4 h-16 w-16 text-muted-foreground" />
    <h3 className="mb-2 text-xl font-semibold">{title}</h3>
    <p className="mb-4 text-muted-foreground">{description}</p>
    {actionLabel && actionHref && (
      <Button asChild>
        <AppLink href={actionHref}>{actionLabel}</AppLink>
      </Button>
    )}
  </div>
);

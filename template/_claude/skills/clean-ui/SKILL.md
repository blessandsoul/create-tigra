---
name: clean-ui
description: Remove the starter welcome page UI and replace with a blank canvas, preserving all client-side functionality (auth, hooks, services, store, middleware, utils)
---

The user wants to remove the starter/welcome UI from the scaffolded client and start with a blank page.

## What this skill does

Replaces the demo welcome page (`src/app/page.tsx`) with the absolute bare minimum — just a centered "Ready to build." text. **Nothing else is touched** — all functional infrastructure remains intact.

## What gets replaced

| File | Action | Reason |
|------|--------|--------|
| `src/app/page.tsx` | **Replace** with blank canvas | Remove ALL demo content — hero, ambient glow, GitHub links, buttons, everything |

## What is NOT touched (preserved as-is)

- `src/components/layout/` — Header, Footer, MainLayout
- `src/app/layout.tsx` — root layout with providers
- `src/app/providers.tsx` — Redux, React Query, themes, AuthInitializer
- `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx`
- `src/middleware.ts` — route protection
- `src/features/auth/**` — entire auth system
- `src/components/common/**` — ThemeToggle, EmptyState, LoadingSpinner, etc.
- `src/components/ui/**` — all shadcn/ui components
- `src/hooks/**`, `src/store/**`, `src/lib/**`, `src/styles/**`
- All config files

## Steps

1. Read `src/app/page.tsx` to confirm it exists.
2. Replace its contents with the clean page below. Use the **exact** template — do not add anything.
3. Confirm to the user what was done.

## Clean page template

Replace `src/app/page.tsx` with **exactly** this — no additions, no modifications:

```tsx
import type React from 'react';

export default function HomePage(): React.ReactElement {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Ready to build.</p>
    </main>
  );
}
```

**CRITICAL**: Do NOT add anything beyond what is in the template above. No heading, no links, no buttons, no metadata, no imports beyond React. The entire point is a blank canvas.

## Response format

After completing, respond with:

```
Starter UI cleaned. `src/app/page.tsx` is now a blank canvas.

Everything else is untouched — auth, hooks, services, store, middleware, components, and design system are all intact.
```

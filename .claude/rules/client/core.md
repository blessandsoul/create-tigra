> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Client Rules — Core Index

**Read only the file relevant to your current task.**

| You are doing... | Read this |
|---|---|
| Creating files, folders, feature modules | `01-project-structure.md` |
| Building components, writing types/interfaces | `02-components-and-types.md` |
| Fetching data, managing state, calling APIs, forms | `03-data-and-state.md` |
| Choosing colors, styling, typography, spacing, motion | `04-design-system.md` |
| Auth tokens, env vars, security headers | `05-security.md` |
| UX psychology, cognitive load, a11y, performance | `06-ux-checklist.md` |

---

## Architecture

```
Page (Server Component — fetches data)
  → Feature Components (Server or Client)
    → UI (shadcn/ui + Tailwind)

State: Server data (SSR) → Server Components
       Server data (client) → React Query
       Global client state → Redux (auth only)
       Local state → useState / useReducer
       URL state → useSearchParams
```

---

## Non-negotiable rules

1. **Mobile-first**: All Tailwind classes start at mobile. Desktop is the enhancement (`md:`, `lg:`). Touch targets min 44x44px. No functionality behind hover-only states.
2. **Server Components by default.** Only add `'use client'` when you need hooks, state, or event handlers.
3. **Component limits**: Max 250 lines, max 5 props, max 3 JSX nesting levels.
4. **No hardcoded colors**: Use Tailwind semantic tokens (`bg-primary`, `text-foreground`). Never hex/rgb.
5. **No inline styles**: Tailwind only. Use `cn()` for conditional classes.
6. **Import order**: React/Next → third-party → UI → local → hooks → services → types → utils.
7. **Forms**: Validate with Zod. Always validate client-side AND server-side.
8. **Security**: Never inject raw HTML without sanitization. Never prefix secrets with `NEXT_PUBLIC_`.

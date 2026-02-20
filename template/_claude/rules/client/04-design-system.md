> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Design System

## Philosophy: "Neuro-Minimalism"

Clean, airy, "expensive" look inspired by Linear, Vercel, Stripe, Arc. Every visual decision reduces cognitive load.

---

## CSS Architecture (Source of Truth)

This project uses **Tailwind CSS v4** with **OKLCH color space** and the `@theme inline` directive (not the legacy `tailwind.config.ts`).

```css
/* app/globals.css */
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  /* ... maps all semantic tokens to Tailwind */
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.45 0.2 260);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.45 0.2 260);
  --success: oklch(0.52 0.17 155);
  --success-foreground: oklch(1 0 0);
  --warning: oklch(0.75 0.18 75);
  --warning-foreground: oklch(0.2 0 0);
  --info: oklch(0.55 0.15 240);
  --info-foreground: oklch(1 0 0);
  --chart-1 through --chart-5  /* Data visualization colors */
  --sidebar, --sidebar-foreground, etc.  /* Sidebar-specific tokens */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* ... dark mode overrides for all tokens */
}
```

**Key differences from Tailwind v3:**
- No `tailwind.config.ts` — all config is CSS-based via `@theme inline`
- Colors use **OKLCH** (perceptually uniform) not HSL
- `@custom-variant dark` replaces `darkMode: 'class'`
- No `@layer base { :root { } }` — variables defined directly on `:root`

## Color Usage

| Token | Purpose | Example use |
|---|---|---|
| `primary` | Main CTAs, links, active states | "Get started" button |
| `secondary` | Secondary actions | Cancel, back |
| `destructive` | Delete, errors | Delete button, error alert |
| `success` | Success states | "Action completed" |
| `warning` | Warnings | "Pending approval" |
| `info` | Information | "New feature" badge |
| `muted` | Disabled, placeholders | Disabled input |
| `accent` | Highlights | "Featured" badge |
| `card` | Card backgrounds | Content card |
| `border` | Borders, dividers | Card border |

### Color Rules

1. **Never hardcode**: No `bg-blue-500`, no `bg-[#3b82f6]`, no `style={{ color }}`. Always semantic tokens.
2. **Semantic names by purpose**: `bg-destructive` not `bg-red`.
3. **Always pair bg + foreground**: `bg-primary text-primary-foreground` for contrast.
4. **Single source of truth**: Change colors only in `globals.css` variables.
5. **90% monochrome**: 90% of UI uses `background`, `foreground`, `muted`, `border`. Color is the exception.
6. **Opacity for hierarchy**: Use `bg-primary/10`, `bg-primary/5` for tinted backgrounds.

---

## Surfaces & Depth

- **Border radius**: `rounded-xl` (12px) or `rounded-2xl` (16px) for cards, modals, containers.
- **Shadows** (layered by elevation):
  - Resting cards: `shadow-sm`
  - Hovered/elevated: `shadow-md` to `shadow-lg`
  - Modals/popovers: `shadow-xl`
- **Glassmorphism**: Only on sticky headers, floating toolbars, modal backdrops. Never on content cards.
  `backdrop-filter: blur(12px) saturate(1.5); background: oklch(from var(--background) l c h / 0.8);`
- **No pure black/white**: Use `--background` and `--foreground` tokens (already off-pure).

---

## Typography

- **Font**: Inter v4 (variable) or Geist Sans via `next/font`.
- **Headings**: `text-wrap: balance`, `leading-tight`. H1: `text-3xl`–`text-4xl`, H2: `text-2xl`.
- **Body**: `text-base`, `leading-relaxed`. Max reading width: `max-w-prose` (~65ch).
- **Data/numbers**: Always `tabular-nums` for alignment.
- **Captions/meta**: `text-sm text-muted-foreground`.

---

## Spacing

- **Whitespace IS the divider.** Prefer spacing over visible borders/lines.
- **Section gap = 2x internal gap**: `space-y-16` between sections, `space-y-6` within.
- **Stick to scale**: `4, 6, 8, 12, 16, 20, 24` from Tailwind. Avoid arbitrary values.
- **Container**: `container mx-auto px-4 md:px-6 lg:px-8`.

---

## Motion & Interactions

Every interactive element MUST have visible `:hover`, `:active`, and `:focus-visible` states.

### Standard Patterns
```
Button:  transition-all duration-200 ease-out hover:brightness-110 active:scale-[0.98]
Card:    transition-all duration-300 ease-out hover:shadow-lg hover:-translate-y-0.5
Link:    transition-colors duration-150 hover:text-primary
```

### Rules
- **Transform + opacity only** — never animate layout properties (`width`, `height`, `top`).
- **Respect `prefers-reduced-motion`**: Use `motion-safe:` / `motion-reduce:` variants.
- **Motion budget**: Max 2-3 animated elements in viewport at once.
- **Zero CLS**: Animations must never cause layout shift.

---

## Images

- **Format priority**: AVIF > WebP > JPEG (Next.js `<Image>` handles this).
- **LCP image**: Always add `priority` prop.
- **Blur placeholder**: Use `placeholder="blur"` with `blurDataURL`.
- **Always set** explicit `width`/`height` or use `aspect-ratio` to prevent CLS.

---

## Modern CSS Features (Use Where Appropriate)

| Feature | Use for |
|---|---|
| `@container` | Component-level responsive behavior |
| CSS Subgrid | Child alignment with parent grid |
| `dvh` | Full-height layouts (avoids mobile browser bar) |
| `<dialog>` | Modals (with glassmorphism backdrop) |
| Popover API | Dropdowns, tooltips |
| `:has()` | Parent-based styling without JS |
| `content-visibility: auto` | Long lists/pages performance |
| `@starting-style` | Entry animations |

---

## Component Visual Patterns

- **Cards**: `rounded-xl border border-border/50 bg-card shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5`
- **Empty states**: Centered, muted icon, 2-line text max, one clear CTA.
- **Loading**: Skeleton loaders matching content shape. Show immediately, no delay.
- **Modals**: Max `max-w-lg`. Dismissible with Escape + backdrop click. Glassmorphism backdrop.

---

## Dark Mode

- Use `next-themes` with `attribute="class"`, `defaultTheme="system"`.
- Reduce shadow visibility in dark mode (use subtle light borders instead).
- Consider `brightness-90` on images in dark mode.
- Add `suppressHydrationWarning` to `<html>` tag.

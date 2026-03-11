> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Design System

## Philosophy: "Mobile-First Neuro-Minimalism"

**Mobile is the default. Desktop is the enhancement.** 80%+ of traffic is mobile — design for thumbs first, cursors second.

Clean, airy, "expensive" look inspired by Linear, Vercel, Stripe, Arc. Every visual decision reduces cognitive load. Every screen must feel like a native app on mobile.

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

---

## Mobile-First Responsive Strategy

**All Tailwind utilities are written for mobile first.** `md:` and `lg:` are progressive enhancements, not the other way around.

### Rules

1. **Write mobile styles as the base.** Add `md:` / `lg:` to override for larger screens. Never use `max-*:` breakpoints.
2. **Breakpoints**: `sm:` (640px) → `md:` (768px) → `lg:` (1024px) → `xl:` (1280px). Scale UP, never down.
3. **Test mobile first** during development. Open DevTools at 375px before checking desktop.
4. **Every screen must be fully usable at 375px width.** No horizontal scroll, no truncated actions, no hidden critical UI.

### Viewport & Safe Areas

- **Use `dvh` instead of `vh`** for full-height layouts — accounts for mobile browser chrome (URL bar, bottom bar).
- **Viewport meta**: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- **Respect safe areas** on notched/dynamic island devices:
  - Bottom-fixed elements: add `pb-[env(safe-area-inset-bottom)]`
  - Top-fixed elements: add `pt-[env(safe-area-inset-top)]`
- **No `100vh` anywhere.** Always `100dvh` or `min-h-dvh`.

### Anti-patterns

- Do NOT write desktop-first classes like `w-1/3 max-md:w-full`. Write `w-full md:w-1/3`.
- Do NOT hide mobile-critical content behind `hidden md:block`. Content strategy must work on mobile first.
- Do NOT use fixed pixel widths. Use `w-full`, percentage-based, or `max-w-*` utilities.

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
- **Headings**: `text-wrap: balance`, `leading-tight`. Mobile-first responsive sizes:
  - H1: `text-2xl md:text-3xl lg:text-4xl`
  - H2: `text-xl md:text-2xl`
  - H3: `text-lg md:text-xl`
- **Body**: `text-base`, `leading-relaxed`. Max reading width: `max-w-prose` (~65ch).
- **Data/numbers**: Always `tabular-nums` for alignment.
- **Captions/meta**: `text-sm text-muted-foreground`.
- **Mobile readability**: Minimum `text-sm` (14px) for any readable text. Never go below 12px.

---

## Spacing

- **Whitespace IS the divider.** Prefer spacing over visible borders/lines.
- **Section gap = 2x internal gap**: Mobile: `space-y-10` between sections, `space-y-4` within. Desktop: `space-y-16` between sections, `space-y-6` within.
- **Stick to scale**: `4, 6, 8, 12, 16, 20, 24` from Tailwind. Avoid arbitrary values.
- **Container**: `container mx-auto px-4 sm:px-6 lg:px-8` (mobile gets comfortable 16px padding).

---

## Motion & Interactions

Every interactive element MUST have visible `:active` and `:focus-visible` states. `:hover` is a desktop enhancement — never the only feedback.

### Standard Patterns (Mobile-First)
```
Button:  transition-all duration-200 ease-out active:scale-[0.97] md:hover:brightness-110
Card:    transition-all duration-300 ease-out active:scale-[0.98] md:hover:shadow-lg md:hover:-translate-y-0.5
Link:    transition-colors duration-150 active:opacity-70 md:hover:text-primary
```

### Rules
- **`active:` is the primary feedback** on mobile. Tap must feel instant and responsive.
- **`hover:` is desktop-only** — always prefix with `md:hover:` to avoid sticky hover on touch devices.
- **No hover-gated functionality**: Anything revealed on hover (tooltips, menus) MUST have a tap/click alternative.
- **Transform + opacity only** — never animate layout properties (`width`, `height`, `top`).
- **Respect `prefers-reduced-motion`**: Use `motion-safe:` / `motion-reduce:` variants.
- **Motion budget**: Max 2-3 animated elements in viewport at once.
- **Zero CLS**: Animations must never cause layout shift.

---

## Touch & Interaction Design

### Touch Targets

- **Minimum size**: 44x44px (`min-h-11 min-w-11`). Recommended: 48x48px (`min-h-12 min-w-12`).
- **Spacing between targets**: Minimum 8px gap to prevent mis-taps.
- **Icon-only buttons**: Use `p-2.5` or `p-3` to ensure the tap area is large enough even if the icon is small.
- **Inline links in text**: Add `py-1` for vertical tap padding without affecting line height visually.

### Thumb Zone Design

- **Primary actions in the bottom third** of the screen — thumbs naturally rest there.
- **Avoid top corners** for critical interactive elements (hardest to reach one-handed).
- **Sticky bottom CTAs**: Primary action buttons stick to bottom of viewport on mobile: `sticky bottom-0 pb-[env(safe-area-inset-bottom)]`.
- **FABs (Floating Action Buttons)**: Position `bottom-6 right-4` for primary creation actions.

### Gesture Support

- **Swipe-to-dismiss** on bottom sheets and drawers (use Vaul / shadcn Drawer).
- **Pull-to-refresh** where contextually appropriate (feed pages, lists).
- **Swipe actions on list items** for quick actions (archive, delete) — use sparingly, always with undo.
- **Pinch-to-zoom** on images and maps — never disable native zoom.

### Mobile Navigation Patterns

| Nav items | Mobile pattern | Desktop pattern |
|---|---|---|
| 2-5 core routes | **Bottom tab bar** (sticky, always visible) | Top horizontal nav |
| 6+ routes | Bottom tab bar (4 items + "More") | Sidebar or top nav with dropdowns |
| Contextual actions | **Bottom sheet** (Drawer component) | Dropdown menu or popover |
| Filters/settings | Full-screen sheet or slide-over panel | Side panel or modal |

- **Bottom nav is the default** on mobile. Top nav on `md:` and above.
- **Bottom sheets over modals** for contextual actions on mobile — they're within thumb reach and feel native.
- **Sticky action bars**: Form submit buttons, checkout CTAs — `sticky bottom-0` on mobile.
- **No hamburger menus** for ≤5 items. Use bottom tab bar instead.

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

- **Cards**: `rounded-xl border border-border/50 bg-card shadow-sm transition-all duration-300 active:scale-[0.98] md:hover:shadow-md md:hover:-translate-y-0.5`
- **Empty states**: Centered, muted icon, 2-line text max, one clear CTA.
- **Loading**: Skeleton loaders matching content shape. Show immediately, no delay.
- **Modals (desktop)**: Max `max-w-lg`. Dismissible with Escape + backdrop click. Glassmorphism backdrop.
- **Bottom sheets (mobile)**: Prefer over centered modals on mobile. Use shadcn Drawer (Vaul). Swipe-down to dismiss. Max 70% viewport height for partial sheets. Respect `pb-[env(safe-area-inset-bottom)]`.
- **Lists**: Full-width on mobile (no horizontal padding on list items — let them bleed to edges for native feel). Add dividers with `border-b border-border/50`.

---

## Dark Mode

- Use `next-themes` with `attribute="class"`, `defaultTheme="system"`.
- Reduce shadow visibility in dark mode (use subtle light borders instead).
- Consider `brightness-90` on images in dark mode.
- Add `suppressHydrationWarning` to `<html>` tag.

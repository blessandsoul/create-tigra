> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Design System

## Philosophy: "Mobile-First Neuro-Minimalism"

**Mobile is the default. Desktop is the enhancement.** 80%+ of traffic is mobile — design for thumbs first, cursors second.

Clean, airy, "expensive" look inspired by Linear, Vercel, Stripe, Arc. Every visual decision reduces cognitive load. Every screen must feel like a native app on mobile.

---

## CSS Architecture (Source of Truth)

This project uses **Tailwind CSS v4** with **OKLCH color space** and the `@theme inline` directive (not the legacy `tailwind.config.ts`).

**Key differences from Tailwind v3:**
- No `tailwind.config.ts` — all config is CSS-based via `@theme inline`
- Colors use **OKLCH** (perceptually uniform) not HSL
- `@custom-variant dark` replaces `darkMode: 'class'`
- No `@layer base { :root { } }` — variables defined on `:root` via theme preset files

---

## Theme Preset System (Color Management)

**ALL color variables live in theme preset files, NOT in `globals.css`.** This is the single source of truth for the entire app's color palette.

### How It Works

```
src/
├── app/globals.css                    ← imports ONE theme preset (switch here)
└── styles/themes/
    ├── warm-orange.css                ← Earthy, warm (default)
    ├── electric-indigo.css            ← Modern, bold, tech-forward
    ├── ocean-teal.css                 ← Calm, professional
    └── rose-pink.css                  ← Elegant, creative
```

`globals.css` imports the active theme via a single line:

```css
@import "../styles/themes/warm-orange.css";
```

**To switch the entire palette**: change that ONE import line. That's it. Every color in the app updates instantly — light mode, dark mode, charts, sidebar, everything.

### Theme Preset Structure

Each preset file defines ALL semantic color variables for both `:root` (light) and `.dark` (dark mode):

```css
:root {
  --radius: 0.625rem;
  --background: oklch(...);
  --foreground: oklch(...);
  --primary: oklch(...);
  --primary-foreground: oklch(...);
  /* ... all ~35 semantic tokens */
}

.dark {
  --background: oklch(...);
  --foreground: oklch(...);
  --primary: oklch(...);
  /* ... dark mode overrides for all tokens */
}
```

### Creating a Custom Theme

1. Copy any existing preset file (e.g., `warm-orange.css`)
2. Rename it (e.g., `my-brand.css`)
3. Edit the OKLCH values to match your brand palette
4. Update the import in `globals.css`: `@import "../styles/themes/my-brand.css";`

### Available Presets

| Preset | Accent | Vibe | Inspired by |
|--------|--------|------|-------------|
| `warm-orange.css` | Terracotta orange | Earthy, warm, approachable | Claude |
| `electric-indigo.css` | Deep indigo-violet | Modern, bold, tech-forward | Linear, Figma |
| `ocean-teal.css` | Deep teal-cyan | Calm, professional, trustworthy | Stripe, Vercel |
| `rose-pink.css` | Soft rose-magenta | Elegant, creative, premium | Dribbble, Notion |

### CRITICAL RULES — Color Management

1. **NEVER add or modify color variables directly in `globals.css`.** All `:root` and `.dark` color variables belong in the active theme preset file only.
2. **NEVER hardcode OKLCH/hex/rgb values in components.** Always use semantic tokens (`bg-primary`, `text-foreground`).
3. **To change the brand palette**: switch the import in `globals.css` or edit the active preset file. Never scatter color values across multiple files.
4. **New semantic tokens**: If you need a new color token (rare), add it to ALL preset files to keep them in sync.
5. **The `@theme inline` block in `globals.css` maps CSS vars to Tailwind** — it does NOT define colors. Colors come from the preset.

---

## Font Preset System (Font Management)

**Font families are defined in font preset files, NOT hardcoded in components.** This mirrors the color theme preset system — switch the entire font pairing by changing one import.

### How It Works

```
src/
├── app/
│   ├── layout.tsx                     ← loads fonts via next/font/google
│   └── globals.css                    ← imports ONE font preset (switch here)
└── styles/fonts/
    └── inter-jetbrains.css            ← Default (Inter + JetBrains Mono)
```

### Three Semantic Font Roles

| Role | CSS Variable | Tailwind Class | Default Font |
|------|-------------|----------------|--------------|
| Body text | `--font-sans-value` | `font-sans` | Inter |
| Headings | `--font-heading-value` | `font-heading` | Inter |
| Code/mono | `--font-mono-value` | `font-mono` | JetBrains Mono |

### How to Switch Fonts

Switching fonts requires two changes:

**Step 1 — Update font imports in `layout.tsx`:**

```tsx
// Change these imports to your desired fonts
import { Roboto, Fira_Code } from 'next/font/google';

const roboto = Roboto({
  variable: '--font-roboto',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const firaCode = Fira_Code({
  variable: '--font-fira-code',
  subsets: ['latin'],
});

// Update the className to use new variables
<body className={`${roboto.variable} ${firaCode.variable} font-sans antialiased`}>
```

**Step 2 — Update the font preset file (or create a new one):**

```css
/* styles/fonts/roboto-fira.css */
:root {
  --font-sans-value: var(--font-roboto);
  --font-heading-value: var(--font-roboto);
  --font-mono-value: var(--font-fira-code);
}
```

Then update the import in `globals.css`:
```css
@import "../styles/fonts/roboto-fira.css";
```

### Font Preset Structure

Each preset maps raw font variables (set by `next/font/google` in `layout.tsx`) to semantic roles:

```css
:root {
  --font-sans-value: var(--font-inter);        /* body text */
  --font-heading-value: var(--font-inter);      /* headings */
  --font-mono-value: var(--font-jetbrains-mono); /* code */
}
```

### Creating a Custom Font Preset

1. Choose your fonts from [Google Fonts](https://fonts.google.com)
2. Update `layout.tsx` — import fonts via `next/font/google`, set CSS variable names
3. Create a new preset file in `src/styles/fonts/` (or edit the existing one)
4. Map your font variables to the three semantic roles
5. Update the import in `globals.css` to point to your preset

### CRITICAL RULES — Font Management

1. **NEVER hardcode font-family values in components.** Always use Tailwind classes (`font-sans`, `font-heading`, `font-mono`).
2. **ALL font-family mappings live in the font preset file**, not in `globals.css` or components.
3. **To change fonts**: update `layout.tsx` imports + update the font preset file. Never scatter font-family values across the codebase.
4. **The `@theme inline` block in `globals.css` maps preset variables to Tailwind** — it does NOT define fonts. Fonts come from the preset.
5. **Fonts are loaded via `next/font/google`** — this self-hosts fonts automatically at build time. No external requests at runtime, no manual file downloads needed.

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
4. **Single source of truth**: Change colors ONLY in the active theme preset file (`src/styles/themes/*.css`). Never in `globals.css`, never in components.
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

- **Font**: Defined by the active font preset (default: Inter for sans/heading, JetBrains Mono for mono). See "Font Preset System" above for how to switch.
- **Headings**: Use `font-heading`. `text-wrap: balance`, `leading-tight`. Mobile-first responsive sizes:
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

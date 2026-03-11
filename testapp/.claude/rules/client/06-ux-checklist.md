> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Neuro-UX Checklist

## Mobile-First UX

**80%+ of traffic is mobile. Design for thumbs, not cursors. Every screen must feel like a native app.**

- Every screen must be fully usable on a 375px viewport. No exceptions.
- **One-handed reachability**: critical actions in the thumb zone (bottom 60% of screen).
- **App-like feel**: smooth transitions between views, no full-page flash reloads, instant feedback on every tap.
- **Content above the fold**: the most important action or information visible without scrolling on mobile.
- **Reduce input friction**: use native input types (`type="tel"`, `type="email"`, `inputMode="numeric"`), autofill, and smart defaults.
- **Scroll is natural**: long pages are fine on mobile — vertical scroll is free. Horizontal scroll is forbidden.

---

## Cognitive Load — Miller's Law

- **Max 5-7 interactive elements** per viewport section. Use progressive disclosure (tabs, accordions, "Show more") for more.

## Gestalt Principles

- **Proximity**: Related items close together. Gap between groups = 2x gap within groups.
- **Grid alignment**: All elements on a strict grid. No floating/misaligned elements.
- **Similarity**: Same action = same visual style across all pages.
- **Common region**: Group related controls in a visual container (`bg-muted/50` or subtle border).

## Instant Feedback

| User action | Required feedback | Timing |
|---|---|---|
| Tap interactive | Press state (`active:scale-[0.97]`) | Instant |
| Tap button | Press state + ripple or scale | Instant |
| Submit form | Loading state on button + disable | Instant |
| Successful action | Toast notification | <500ms |
| Failed action | Inline error OR toast | <500ms |
| Navigate | Skeleton or smooth page transition | Instant |
| Swipe drawer/sheet | Follow finger + snap or dismiss | Instant |
| Pull to refresh | Pull indicator + content reload | Instant |
| Hover interactive (desktop only) | Color/shadow/scale change | <100ms |

- **Optimistic UI**: Update UI immediately before server confirms. Revert on error.
- **Skeletons over spinners. Always.** Spinners only inside buttons during submission.
- **Touch feedback is non-negotiable**: Every tappable element must visually respond to touch immediately.

## Nielsen's 10 Heuristics (Mobile-Adapted)

1. **System status**: Show loading, toast on completion, inline validation as user types. On mobile: progress indicators for multi-step flows.
2. **Real-world match**: Human language ("Sign in" not "Authenticate"). Locale-formatted dates/currencies. Native input types (`type="email"`, `inputMode="numeric"`).
3. **User control**: Swipe gestures for dismiss/back. Bottom sheets dismissible by swipe-down. Every modal dismissible with Escape (desktop) + backdrop + swipe (mobile). Undo for destructive actions. Back always works — preserve scroll position on back navigation.
4. **Consistency**: Same action = same button style, position, label everywhere. Bottom nav consistent across all pages on mobile.
5. **Error prevention**: Real-time validation. Disable submit until valid. Type-appropriate inputs with correct keyboard (`inputMode`). Confirm destructive actions with bottom sheet confirmation on mobile.
6. **Recognition > recall**: Visible labels (not placeholder-only). Show recent searches. Bottom nav on mobile, top nav on desktop.
7. **Flexibility**: Keyboard shortcuts (Cmd+K) on desktop. Gesture shortcuts (swipe actions on list items) on mobile. Preserve filters in URL. Bulk actions where appropriate.
8. **Minimalist design**: Every element earns its place. Prefer whitespace over separators. On mobile: even more aggressive — reduce to one primary action per screen.
9. **Error recovery**: Say what went wrong + how to fix it. Highlight the field. Never clear form on error. On mobile: scroll to the first error field automatically.
10. **Help**: Contextual tooltips (tap-to-show on mobile, hover on desktop). Dismissible onboarding hints.

## Performance Targets

| Metric | Mobile Target | Desktop Target |
|---|---|---|
| Lighthouse Performance | 90+ | 98+ |
| Lighthouse Accessibility | 98+ | 98+ |
| LCP | <2.5s | <2.0s |
| CLS | 0 | 0 |
| INP | <150ms | <200ms |

- **Test on real mobile devices** or throttled Chrome DevTools (4x CPU slowdown, Fast 3G).
- **Bundle size matters more on mobile**: lazy-load routes, code-split aggressively, defer non-critical JS.

## Accessibility

- All interactive elements reachable via Tab in logical order.
- Focus rings: `:focus-visible` only (not `:focus`). Style: `ring-2 ring-primary/50`.
- Icon-only buttons: must have `aria-label`.
- One `h1` per page. No skipped heading levels.
- Dynamic content updates: `aria-live="polite"`.
- All animations in `motion-safe:` variant.
- WCAG AA contrast: 4.5:1 for text, 3:1 for large text/UI.
- **Touch targets**: min 44x44px, recommended 48x48px. No exceptions.
- **Spacing between touch targets**: min 8px gap to prevent mis-taps.
- **No hover-only functionality**: everything accessible via tap on mobile.

## Microcopy

- **Buttons**: Action verbs — "Save changes", "Create item", "Delete account". Never "Submit" or "OK".
- **Toasts**: Under 10 words. Success: confirm. Error: what happened + what to do.
- **Empty states**: Explain what this area is for + CTA to fill it. ("No items yet. Create your first one.")
- **Form errors**: Specific to the field. Below the field. Red text + red border.

## Page Audit Checklist

1. Interactive elements per section ≤ 7?
2. All elements on grid?
3. Every button/link has active + focus-visible? (hover is `md:` only)
4. Skeletons for all async content?
5. Inline field-level errors on forms?
6. Every modal/sheet dismissible with Escape (desktop) + swipe (mobile)?
7. Tab through all elements in logical order?
8. Text passes WCAG AA contrast?
9. All animation in `motion-safe:`?
10. LCP image has `priority`?
11. All touch targets ≥ 44x44px?
12. Primary actions in thumb zone (bottom of screen)?
13. Bottom sheet used instead of centered modal on mobile?
14. Tested on 375px viewport width?
15. No hover-only functionality?
16. Safe areas respected on fixed/sticky elements?
17. Native input types used (`type="email"`, `inputMode="numeric"`, etc.)?

> **SCOPE**: These rules apply specifically to the **client** directory (Next.js App Router).

# Neuro-UX Checklist

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
| Click button | Press state (`active:scale-[0.98]`) | Instant |
| Submit form | Loading state on button + disable | Instant |
| Successful action | Toast notification | <500ms |
| Failed action | Inline error OR toast | <500ms |
| Navigate | Skeleton or page transition | Instant |
| Hover interactive | Color/shadow/scale change | <100ms |

- **Optimistic UI**: Update UI immediately before server confirms. Revert on error.
- **Skeletons over spinners. Always.** Spinners only inside buttons during submission.

## Nielsen's 10 Heuristics

1. **System status**: Show loading, toast on completion, inline validation as user types.
2. **Real-world match**: Human language ("Sign in" not "Authenticate"). Locale-formatted dates/currencies.
3. **User control**: Every modal dismissible with Escape + backdrop. Undo for destructive actions. Back always works.
4. **Consistency**: Same action = same button style, position, label everywhere.
5. **Error prevention**: Real-time validation. Disable submit until valid. Type-appropriate inputs. Confirm destructive actions.
6. **Recognition > recall**: Visible labels (not placeholder-only). Show recent searches. Visible nav on desktop.
7. **Flexibility**: Keyboard shortcuts (Cmd+K). Preserve filters in URL. Bulk actions where appropriate.
8. **Minimalist design**: Every element earns its place. Prefer whitespace over separators.
9. **Error recovery**: Say what went wrong + how to fix it. Highlight the field. Never clear form on error.
10. **Help**: Contextual tooltips on complex features. Dismissible onboarding hints.

## Performance Targets

| Metric | Target |
|---|---|
| Lighthouse Performance | 98+ |
| Lighthouse Accessibility | 98+ |
| LCP | <2.5s |
| CLS | 0 |
| INP | <200ms |

## Accessibility

- All interactive elements reachable via Tab in logical order.
- Focus rings: `:focus-visible` only (not `:focus`). Style: `ring-2 ring-primary/50`.
- Icon-only buttons: must have `aria-label`.
- One `h1` per page. No skipped heading levels.
- Dynamic content updates: `aria-live="polite"`.
- All animations in `motion-safe:` variant.
- WCAG AA contrast: 4.5:1 for text, 3:1 for large text/UI.

## Microcopy

- **Buttons**: Action verbs — "Save changes", "Create item", "Delete account". Never "Submit" or "OK".
- **Toasts**: Under 10 words. Success: confirm. Error: what happened + what to do.
- **Empty states**: Explain what this area is for + CTA to fill it. ("No items yet. Create your first one.")
- **Form errors**: Specific to the field. Below the field. Red text + red border.

## Page Audit Checklist

1. Interactive elements per section ≤ 7?
2. All elements on grid?
3. Every button/link has hover + active + focus-visible?
4. Skeletons for all async content?
5. Inline field-level errors on forms?
6. Every modal dismissible with Escape?
7. Tab through all elements in logical order?
8. Text passes WCAG AA contrast?
9. All animation in `motion-safe:`?
10. LCP image has `priority`?

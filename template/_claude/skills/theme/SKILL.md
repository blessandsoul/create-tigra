---
name: theme
description: Change the color palette in the client theme file. Only swaps HEX values — never touches variable names, file structure, or conventions.
argument-hint: "[color description or specific HEX values]"
---

# Theme Palette Changer

The user wants to change the color palette. Their input: **$ARGUMENTS**

## Your ONLY job

Replace HEX color values in `src/styles/themes/default.css` (or the equivalent theme file in the active project's client directory). That's it.

## What you MUST NOT do

- **DO NOT** rename, add, or remove any CSS variable names (e.g., `--primary`, `--background`, `--muted`)
- **DO NOT** change the file structure, move files, or create new files
- **DO NOT** touch `globals.css`, components, or any other file
- **DO NOT** change `--radius` or any non-color value
- **DO NOT** convert HEX to OKLCH, HSL, or any other format — stay in HEX
- **DO NOT** remove the `.dark` selector or the `:root` selector
- **DO NOT** remove or rewrite comments unless updating the palette description at the top
- **DO NOT** change `rgba()` values to HEX — keep `rgba()` where it already exists (e.g., dark mode `--border`, `--input`)
- **DO NOT** touch any code outside the theme file — no components, no Tailwind config, no globals

## Before making changes — ask these questions if not answered

You MUST gather enough information before editing. If the user's input doesn't cover these, ask BEFORE making any changes:

### Required information

1. **Primary/brand color** — What is the main accent color? (at minimum, you need this)

### Clarifying questions (ask if not addressed)

2. **Dark mode** — one of:
   - "Will you provide dark mode colors yourself, or should I generate them from your palette?"
   - Skip if user explicitly says "light mode only" or provides both sets

3. **Palette vibe/mood** — if the user only gave a single color or vague description:
   - "What's the mood? (e.g., warm, cool, corporate, playful, minimal, luxury)"
   - This helps you pick complementary background, muted, secondary, and accent colors

4. **Background preference** — if not obvious from context:
   - "Do you want a light cream/warm background, a cool/gray background, or pure white?"

5. **Destructive/success/warning/info** — if the user provides a full custom palette but skips these:
   - "Should I keep the current red/green/amber/blue for status colors, or adjust them to match your new palette?"

### When you have enough

- User gives a full palette with explicit HEX values for most tokens → just apply them, generate any missing ones
- User gives a brand color + mood → generate a cohesive palette and present it for approval before applying
- User gives a full set of colors for both light and dark → apply directly

## How to apply changes

1. **Read** the current `default.css` theme file first
2. **Locate** the correct theme file:
   - In a scaffolded project: `client/src/styles/themes/default.css`
   - In the template: `template/client/src/styles/themes/default.css`
   - Check which one exists in the current working directory
3. **Present** your proposed palette to the user in a readable table BEFORE editing:

   | Token | Current | New (Light) | New (Dark) |
   |-------|---------|-------------|------------|
   | --background | #f4f3ee | #... | #... |
   | --primary | #c15f3c | #... | #... |
   | ... | ... | ... | ... |

4. **Wait for user approval** — do not edit until they confirm
5. **Edit** the file using the Edit tool — only change HEX values
6. **Update** the comment block at the top to reflect the new palette name/vibe (e.g., "Ocean blue palette" instead of "Claude-inspired warm palette")
7. **Confirm** what was changed in a brief summary

## Palette generation guidelines

When generating colors from a brand color, follow these principles:

- **Background**: Very desaturated, light tint of the brand hue (light mode) / very dark shade (dark mode)
- **Foreground**: Near-black with a hint of the brand hue (light mode) / near-white (dark mode)
- **Primary**: The brand color itself (light) / slightly lighter/more vibrant version (dark)
- **Primary-foreground**: White or near-white for contrast against primary
- **Secondary/muted/accent**: Desaturated, low-contrast versions of the brand palette
- **Card/popover**: White or very slight tint (light) / slightly elevated dark shade (dark)
- **Border/input**: Very subtle, low-contrast separator colors
- **Ring**: Same as primary (focus ring should match brand)
- **Destructive**: Red family (#e7000b light / #ff6467 dark) — adjust warmth/coolness to match palette
- **Success**: Green family — adjust to match palette temperature
- **Warning**: Amber/yellow family — adjust to match palette temperature
- **Info**: Blue family — adjust to match palette temperature
- **Chart colors**: 5 distinct, harmonious colors for data visualization
- **Sidebar**: Slightly different shade than main background for visual separation

### Dark mode rules

- Increase brightness of the primary color (not just invert)
- Background should be very dark (not pure black) with a hint of the brand hue
- Borders use `rgba()` for subtle transparency — keep this pattern
- Foreground colors should be off-white, not pure #ffffff
- Reduce contrast slightly compared to light mode to reduce eye strain

## Edge cases

- If user says "make it blue" → ask for a specific shade or suggest 3 options (e.g., ocean #0066cc, royal #4169e1, navy #1a237e)
- If user provides only RGB or HSL → convert to HEX yourself, don't ask them to convert
- If user wants to keep some colors and change others → only change the ones they specified
- If the theme file doesn't exist → tell the user to scaffold the project first, don't create the file

# Theme & Design Tokens

## Token Summary

- **Primary**: `oklch(0.205 0 0)` (Dark foreground token in light mode)
- **Background**: `oklch(1 0 0)` (White) / Dark: `oklch(0.145 0 0)`
- **Foreground**: `oklch(0.145 0 0)` / Dark: `oklch(0.985 0 0)`
- **Accent**: `oklch(0.97 0 0)` / Dark: `oklch(0.269 0 0)`
- **Muted**: `oklch(0.97 0 0)` / Dark: `oklch(0.269 0 0)`
- **Border**: `oklch(0.922 0 0)` / Dark: `oklch(1 0 0 / 10%)`
- **Radius**: `0.625rem` (`10px`), sm: `6px`, md: `8px`, lg: `10px`, xl: `14px`
- **Typography**: Geist Sans, Geist Mono

## Raw Tailwind / CSS Tokens

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
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
  --ring: oklch(0.708 0 0);
}
```

# Page Dependency Trees

## / (Home)
Entry: `src/app/page.tsx`
Dependencies:
- `src/components/Sidebar.tsx`

## /chat (Chat Page)
Entry: `src/app/chat/page.tsx`
Dependencies:
- `src/components/ChatInterface.tsx`
  - `src/components/ui/button.tsx`
  - `src/components/ui/input.tsx`
  - `src/components/ui/card.tsx`
  - `src/components/ui/scroll-area.tsx`

## /translator (Translator Page)
Entry: `src/app/translator/page.tsx`
Dependencies:
- `src/components/ui/textarea.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/button.tsx`

## /admin (Admin Page)
Entry: `src/app/admin/page.tsx`
Dependencies:
- `src/components/admin-settings-form.tsx`
  - `src/components/ui/input.tsx`
  - `src/components/ui/button.tsx`

import { z } from 'zod';

export const replyTemplateCategorySchema = z.enum(['emails', 'google_reviews']);
export type ReplyTemplateCategory = z.infer<typeof replyTemplateCategorySchema>;

export const REPLY_TEMPLATE_CATEGORIES = [
  { value: 'emails', label: 'Emaile' },
  { value: 'google_reviews', label: 'Opinie Google' },
] as const;

export const replyTemplateSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(16000),
});

export const replyTemplatesSchema = z.array(replyTemplateSchema).max(100).refine(
  (templates) => new Set(templates.map(({ id }) => id)).size === templates.length,
);

export type ReplyTemplate = z.infer<typeof replyTemplateSchema>;

export const replyLibrarySchema = z.object({
  category: replyTemplateCategorySchema.default('emails'),
  templates: replyTemplatesSchema,
  revision: z.number().int().min(1).max(2147483646),
});
export type ReplyLibrary = z.infer<typeof replyLibrarySchema>;

export const DEFAULT_REPLY_TEMPLATES: ReplyTemplate[] = [
  {
    id: 'quote-pl',
    title: 'Odpowiedź z wyceną · PL',
    content: 'Dzień dobry,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}',
  },
  {
    id: 'quote-en',
    title: 'Odpowiedź z wyceną · EN',
    content: 'Hello,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}',
  },
  {
    id: 'order-details',
    title: 'Doprecyzowanie zamówienia',
    content: 'Dzień dobry,\n\nDziękujemy za wiadomość. Prosimy o podanie liczby uczestników, wybranego pakietu lub broni i liczby strzałów dla każdej osoby oraz preferowanej daty i godziny wizyty.\n\nNa tej podstawie przygotujemy wycenę i sprawdzimy dostępność terminu.',
  },
];

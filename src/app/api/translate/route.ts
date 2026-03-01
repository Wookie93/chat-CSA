import { z } from 'zod';

const translateSchema = z.object({
    text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 chars)'),
    sourceLang: z.string().optional(), // undefined = auto-detect
    targetLang: z.string().min(1, 'Target language is required'),
});

export async function POST(req: Request) {
    try {
        const apiKey = process.env.DEEPL_API_KEY;
        if (!apiKey) {
            return Response.json({ error: 'DeepL API key is not configured.' }, { status: 500 });
        }

        const body = await req.json();
        const parsed = translateSchema.safeParse(body);
        if (!parsed.success) {
            return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const { text, sourceLang, targetLang } = parsed.data;

        // DeepL free tier uses api-free.deepl.com, paid uses api.deepl.com
        // We try paid first and fall back based on the key suffix convention (:fx = free)
        const baseUrl = apiKey.endsWith(':fx')
            ? 'https://api-free.deepl.com'
            : 'https://api.deepl.com';

        const params = new URLSearchParams({
            text,
            target_lang: targetLang,
        });
        if (sourceLang && sourceLang !== 'AUTO') {
            params.append('source_lang', sourceLang);
        }

        const response = await fetch(`${baseUrl}/v2/translate`, {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('DeepL API error:', response.status, errorText);
            if (response.status === 403) {
                return Response.json({ error: 'Invalid DeepL API key. Check your DEEPL_API_KEY.' }, { status: 403 });
            }
            if (response.status === 456) {
                return Response.json({ error: 'DeepL quota exceeded for this month.' }, { status: 429 });
            }
            return Response.json({ error: `Translation failed (${response.status})` }, { status: response.status });
        }

        const data = await response.json();
        const translation = data.translations?.[0];

        if (!translation) {
            return Response.json({ error: 'No translation returned.' }, { status: 500 });
        }

        return Response.json({
            translatedText: translation.detected_source_language
                ? `${translation.text}`
                : translation.text,
            detectedSourceLang: translation.detected_source_language ?? null,
        });
    } catch (error) {
        console.error('Translate API error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return Response.json({ error: `Internal Server Error: ${message}` }, { status: 500 });
    }
}

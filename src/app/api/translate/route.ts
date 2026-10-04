import { z } from 'zod';
import { checkAppAccess, checkMutationOrigin } from '@/lib/access';
import { checkRateLimit, readJsonBody, RequestError } from '@/lib/request-limits';

const translateSchema = z.object({
    text: z.string().min(1, 'Text is required').max(5000, 'Text too long (max 5000 chars)'),
    sourceLang: z.string().max(10).regex(/^[A-Z]{2,4}(?:-[A-Z]{2,4})?$/).optional(), // undefined = auto-detect
    targetLang: z.string().max(10).regex(/^[A-Z]{2,3}(?:-[A-Z]{2,4})?$/),
});

export async function POST(req: Request) {
    const denied = checkAppAccess(req.headers.get('authorization')) ?? checkMutationOrigin(req);
    if (denied) return denied;
    try {
        const apiKey = process.env.DEEPL_API_KEY;
        if (!apiKey) {
            return Response.json({ error: 'DeepL API key is not configured.' }, { status: 500 });
        }

        const body = await readJsonBody(req, 24000);
        const parsed = translateSchema.safeParse(body);
        if (!parsed.success) {
            return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const limited = await checkRateLimit('translate');
        if (limited) return limited;
        const { text, sourceLang, targetLang } = parsed.data;

        // DeepL free tier uses api-free.deepl.com, paid uses api.deepl.com
        // Select the endpoint using the key suffix convention (:fx = free)
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
            signal: AbortSignal.any([req.signal, AbortSignal.timeout(30000)]),
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
            translatedText: translation.text,
            detectedSourceLang: translation.detected_source_language ?? null,
        });
    } catch (error) {
        if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: 'Translation failed. Please try again.' }, { status: 502 });
    }
}

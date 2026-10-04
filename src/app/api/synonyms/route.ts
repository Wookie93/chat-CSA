import { z } from 'zod';
import { checkAppAccess } from '@/lib/access';

const synonymSchema = z.object({
    word: z.string().min(1, 'Word is required').max(100, 'Word too long'),
});

export async function GET(req: Request) {
    const denied = checkAppAccess(req.headers.get('authorization'));
    if (denied) return denied;
    try {
        const { searchParams } = new URL(req.url);
        const word = searchParams.get('word');

        const parsed = synonymSchema.safeParse({ word });
        if (!parsed.success) {
            return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const response = await fetch(
            `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(parsed.data.word)}&max=12`,
            { next: { revalidate: 86400 }, signal: AbortSignal.any([req.signal, AbortSignal.timeout(10000)]) } // cache for 24h
        );

        if (!response.ok) {
            return Response.json({ error: 'Failed to fetch synonyms' }, { status: 502 });
        }

        const data: Array<{ word: string; score: number; tags?: string[] }> = await response.json();

        const results = data.slice(0, 8).map((item) => item.word);

        return Response.json({ word: parsed.data.word, synonyms: results });
    } catch (error) {
        console.error('Synonyms API error:', error);
        return Response.json({ error: 'Could not fetch synonyms.' }, { status: 502 });
    }
}

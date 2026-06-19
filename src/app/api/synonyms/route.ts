import { z } from 'zod';

const synonymSchema = z.object({
    word: z.string().min(1, 'Word is required').max(100, 'Word too long'),
});

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const word = searchParams.get('word');

        const parsed = synonymSchema.safeParse({ word });
        if (!parsed.success) {
            return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const response = await fetch(
            `https://api.datamuse.com/words?ml=${encodeURIComponent(parsed.data.word)}&max=12`,
            { next: { revalidate: 86400 } } // cache for 24h
        );

        if (!response.ok) {
            return Response.json({ error: 'Failed to fetch synonyms' }, { status: 502 });
        }

        const data: Array<{ word: string; score: number; tags?: string[] }> = await response.json();

        // Filter for actual synonyms (tagged 'syn') and fall back to all results
        const synonyms = data.filter((item) => item.tags?.includes('syn'));
        const results = (synonyms.length > 0 ? synonyms : data).slice(0, 8).map((item) => item.word);

        return Response.json({ word: parsed.data.word, synonyms: results });
    } catch (error) {
        console.error('Synonyms API error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return Response.json({ error: `Internal Server Error: ${message}` }, { status: 500 });
    }
}

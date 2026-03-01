'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight, Copy, Check, Loader2, Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

const LANGUAGES = [
    { code: 'AUTO', label: 'Detect language' },
    { code: 'BG', label: 'Bulgarian' },
    { code: 'CS', label: 'Czech' },
    { code: 'DA', label: 'Danish' },
    { code: 'DE', label: 'German' },
    { code: 'EL', label: 'Greek' },
    { code: 'EN', label: 'English' },
    { code: 'ES', label: 'Spanish' },
    { code: 'ET', label: 'Estonian' },
    { code: 'FI', label: 'Finnish' },
    { code: 'FR', label: 'French' },
    { code: 'HU', label: 'Hungarian' },
    { code: 'ID', label: 'Indonesian' },
    { code: 'IT', label: 'Italian' },
    { code: 'JA', label: 'Japanese' },
    { code: 'KO', label: 'Korean' },
    { code: 'LT', label: 'Lithuanian' },
    { code: 'LV', label: 'Latvian' },
    { code: 'NB', label: 'Norwegian' },
    { code: 'NL', label: 'Dutch' },
    { code: 'PL', label: 'Polish' },
    { code: 'PT', label: 'Portuguese' },
    { code: 'RO', label: 'Romanian' },
    { code: 'RU', label: 'Russian' },
    { code: 'SK', label: 'Slovak' },
    { code: 'SL', label: 'Slovenian' },
    { code: 'SV', label: 'Swedish' },
    { code: 'TR', label: 'Turkish' },
    { code: 'UK', label: 'Ukrainian' },
    { code: 'ZH', label: 'Chinese' },
];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== 'AUTO');
const MAX_CHARS = 5000;

export default function TranslatorPage() {
    const [sourceText, setSourceText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [sourceLang, setSourceLang] = useState('AUTO');
    const [targetLang, setTargetLang] = useState('PL');
    const [detectedLang, setDetectedLang] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    // Auto-translate: fire 1s after the user stops typing
    useEffect(() => {
        if (!sourceText.trim()) return;
        const timer = setTimeout(() => handleTranslate(), 1000);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceText, sourceLang, targetLang]);

    const handleTranslate = useCallback(async () => {
        if (!sourceText.trim()) return;

        setIsLoading(true);
        setTranslatedText('');
        setDetectedLang(null);

        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: sourceText,
                    sourceLang: sourceLang === 'AUTO' ? undefined : sourceLang,
                    targetLang,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                toast.error(data.error ?? 'Translation failed');
                return;
            }

            setTranslatedText(data.translatedText);
            if (data.detectedSourceLang) {
                const detected = LANGUAGES.find((l) => l.code === data.detectedSourceLang);
                setDetectedLang(detected?.label ?? data.detectedSourceLang);
            }
        } catch {
            toast.error('Network error — could not reach the server');
        } finally {
            setIsLoading(false);
        }
    }, [sourceText, sourceLang, targetLang]);

    const handleSwap = () => {
        if (sourceLang === 'AUTO') return;
        const prevSource = sourceLang;
        const prevTarget = targetLang;
        setSourceLang(prevTarget);
        setTargetLang(prevSource);
        setSourceText(translatedText);
        setTranslatedText('');
        setDetectedLang(null);
    };

    const handleCopy = async () => {
        if (!translatedText) return;
        await navigator.clipboard.writeText(translatedText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const charCount = sourceText.length;

    return (
        <div className="min-h-screen flex flex-col bg-background">
            {/* Header */}
            <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="container mx-auto px-4 h-14 flex items-center gap-3">
                    <Link href="/">
                        <Button variant="ghost" size="icon" className="shrink-0" title="Back to Chat">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div className="flex items-center gap-2">
                        <Languages className="h-5 w-5 text-primary" />
                        <h1 className="text-lg font-semibold">Translator</h1>
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">Powered by DeepL</span>
                </div>
            </header>

            {/* Main */}
            <main className="flex-1 container mx-auto px-4 py-6 flex flex-col gap-4">
                {/* Language selectors + swap */}
                <div className="flex items-center gap-2">
                    {/* Source language */}
                    <div className="flex-1">
                        <select
                            value={sourceLang}
                            onChange={(e) => { setSourceLang(e.target.value); setDetectedLang(null); }}
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                        >
                            {LANGUAGES.map((lang) => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Swap button */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleSwap}
                        disabled={sourceLang === 'AUTO' || isLoading}
                        title="Swap languages"
                        className="shrink-0"
                    >
                        <ArrowLeftRight className="h-4 w-4" />
                    </Button>

                    {/* Target language */}
                    <div className="flex-1">
                        <select
                            value={targetLang}
                            onChange={(e) => setTargetLang(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                        >
                            {TARGET_LANGUAGES.map((lang) => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Text panels */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                    {/* Source panel */}
                    <Card className="flex flex-col">
                        <CardContent className="flex flex-col gap-2 p-4 h-full">
                            <Textarea
                                placeholder="Enter text to translate…"
                                value={sourceText}
                                onChange={(e) => setSourceText(e.target.value.slice(0, MAX_CHARS))}
                                className="flex-1 min-h-[280px] resize-none text-base border-0 shadow-none focus-visible:ring-0 p-0"
                            />
                            <div className="flex items-center justify-between pt-2 border-t">
                                <span className={`text-xs ${charCount > MAX_CHARS * 0.9 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                                </span>
                                <Button
                                    onClick={handleTranslate}
                                    disabled={!sourceText.trim() || isLoading}
                                    size="sm"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Translating…
                                        </>
                                    ) : (
                                        'Translate'
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Result panel */}
                    <Card className="flex flex-col relative">
                        <CardContent className="flex flex-col gap-2 p-4 h-full">
                            {detectedLang && (
                                <p className="text-xs text-muted-foreground">
                                    Detected: <span className="font-medium">{detectedLang}</span>
                                </p>
                            )}
                            <div className="flex-1 relative min-h-[280px]">
                                {isLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : (
                                    <p className={`text-base whitespace-pre-wrap leading-relaxed ${!translatedText ? 'text-muted-foreground italic' : ''}`}>
                                        {translatedText || 'Translation will appear here…'}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center justify-end pt-2 border-t">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCopy}
                                    disabled={!translatedText}
                                    className="gap-1.5"
                                >
                                    {copied ? (
                                        <>
                                            <Check className="h-3.5 w-3.5 text-green-500" />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3.5 w-3.5" />
                                            Copy
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </main>
        </div>
    );
}

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeftRight, Copy, Check, Loader2, Languages, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

// Languages supported by synonym lookup (Datamuse only supports English)
const SYNONYM_LANGUAGES = ['EN'];

const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.code !== 'AUTO');
const MAX_CHARS = 5000;

// ──────────────────────────────────────────────────
// Synonym Popover component
// ──────────────────────────────────────────────────

interface SynonymPopoverProps {
    word: string;
    anchorRect: DOMRect;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onSelect: (synonym: string) => void;
    onClose: () => void;
}

function SynonymPopover({ word, anchorRect, containerRef, onSelect, onClose }: SynonymPopoverProps) {
    const [synonyms, setSynonyms] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    // Fetch synonyms
    useEffect(() => {
        const controller = new AbortController();

        async function fetchSynonyms() {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch(
                    `/api/synonyms?word=${encodeURIComponent(word.toLowerCase())}`,
                    { signal: controller.signal }
                );
                const data = await res.json();
                if (!res.ok) {
                    setError(data.error ?? 'Failed to load synonyms');
                    return;
                }
                setSynonyms(data.synonyms ?? []);
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError('Could not fetch synonyms');
            } finally {
                setIsLoading(false);
            }
        }

        fetchSynonyms();
        return () => controller.abort();
    }, [word]);

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        function handleEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    // Position calculation – relative to the container
    const containerRect = containerRef.current?.getBoundingClientRect();
    const top = containerRect
        ? anchorRect.bottom - containerRect.top + 6
        : anchorRect.bottom + 6;
    const left = containerRect
        ? anchorRect.left - containerRect.left + anchorRect.width / 2
        : anchorRect.left + anchorRect.width / 2;

    return (
        <div
            ref={popoverRef}
            className="synonym-popover"
            style={{
                position: 'absolute',
                top: `${top}px`,
                left: `${left}px`,
                transform: 'translateX(-50%)',
                zIndex: 50,
            }}
        >
            {/* Arrow */}
            <div className="synonym-popover-arrow" />

            <div className="synonym-popover-header">
                <Replace className="h-3 w-3" />
                <span>Synonyms for &ldquo;{word}&rdquo;</span>
            </div>

            <div className="synonym-popover-body">
                {isLoading && (
                    <div className="synonym-popover-loading">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading…</span>
                    </div>
                )}

                {error && <div className="synonym-popover-error">{error}</div>}

                {!isLoading && !error && synonyms.length === 0 && (
                    <div className="synonym-popover-empty">No synonyms found</div>
                )}

                {!isLoading && !error && synonyms.length > 0 && (
                    <ul className="synonym-popover-list">
                        {synonyms.map((syn) => (
                            <li key={syn}>
                                <button
                                    className="synonym-popover-item"
                                    onClick={() => onSelect(syn)}
                                >
                                    {syn}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────
// Translated text with clickable words
// ──────────────────────────────────────────────────

interface TranslatedTextProps {
    text: string;
    canShowSynonyms: boolean;
    onTextChange: (newText: string) => void;
}

/**
 * Tokenises translated text into words and whitespace/punctuation.
 * Words become clickable spans for synonym lookup.
 */
function TranslatedText({ text, canShowSynonyms, onTextChange }: TranslatedTextProps) {
    const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Tokenise text into words and non-words
    const tokens = text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu) ?? [];

    const handleWordClick = (index: number, event: React.MouseEvent<HTMLSpanElement>) => {
        if (!canShowSynonyms) return;
        const token = tokens[index];
        // Only trigger for actual words (not punctuation / whitespace)
        if (!/[\p{L}]/u.test(token)) return;
        // If already active, toggle off
        if (activeWordIndex === index) {
            setActiveWordIndex(null);
            setAnchorRect(null);
            return;
        }
        setActiveWordIndex(index);
        setAnchorRect(event.currentTarget.getBoundingClientRect());
    };

    const handleSynonymSelect = (synonym: string) => {
        if (activeWordIndex === null) return;
        const originalWord = tokens[activeWordIndex];

        // Preserve capitalisation of the original word
        let replacement = synonym;
        if (originalWord[0] === originalWord[0].toUpperCase()) {
            replacement = synonym.charAt(0).toUpperCase() + synonym.slice(1);
        }
        if (originalWord === originalWord.toUpperCase() && originalWord.length > 1) {
            replacement = synonym.toUpperCase();
        }

        const newTokens = [...tokens];
        newTokens[activeWordIndex] = replacement;
        onTextChange(newTokens.join(''));
        setActiveWordIndex(null);
        setAnchorRect(null);
    };

    const handleClose = useCallback(() => {
        setActiveWordIndex(null);
        setAnchorRect(null);
    }, []);

    return (
        <div ref={containerRef} className="relative">
            <p className="text-base whitespace-pre-wrap leading-relaxed">
                {tokens.map((token, idx) => {
                    const isWord = /[\p{L}]/u.test(token);
                    if (!isWord || !canShowSynonyms) {
                        return <span key={idx}>{token}</span>;
                    }
                    return (
                        <span
                            key={idx}
                            onClick={(e) => handleWordClick(idx, e)}
                            className={`synonym-word ${activeWordIndex === idx ? 'synonym-word-active' : ''}`}
                        >
                            {token}
                        </span>
                    );
                })}
            </p>

            {activeWordIndex !== null && anchorRect && (
                <SynonymPopover
                    word={tokens[activeWordIndex]}
                    anchorRect={anchorRect}
                    containerRef={containerRef}
                    onSelect={handleSynonymSelect}
                    onClose={handleClose}
                />
            )}
        </div>
    );
}

// ──────────────────────────────────────────────────
// Main Translator Page
// ──────────────────────────────────────────────────

export default function TranslatorPage() {
    const [sourceText, setSourceText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [sourceLang, setSourceLang] = useState('AUTO');
    const [targetLang, setTargetLang] = useState('PL');
    const [detectedLang, setDetectedLang] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    // Resolve the effective target language for synonym support check
    const effectiveTargetLang = targetLang;
    const canShowSynonyms = SYNONYM_LANGUAGES.includes(effectiveTargetLang);

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
        <div className="flex-1 flex flex-col">
            {/* Title */}
            <div className="flex items-center gap-2 mb-4">
                <Languages className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-semibold">Translator</h1>
                <Badge variant="secondary" className="ml-1">
                    Powered by DeepL
                </Badge>
            </div>

            {/* Main */}
            <div className="flex-1 flex flex-col gap-4">
                {/* Language selectors + swap */}
                <div className="flex items-center gap-2">
                    {/* Source language */}
                    <div className="flex-1">
                        <Select
                            value={sourceLang}
                            onValueChange={(value) => {
                                setSourceLang(value);
                                setDetectedLang(null);
                            }}
                        >
                            <SelectTrigger id="source-language-select">
                                <SelectValue placeholder="Select source language" />
                            </SelectTrigger>
                            <SelectContent>
                                {LANGUAGES.map((lang) => (
                                    <SelectItem key={lang.code} value={lang.code}>
                                        {lang.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Swap button */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleSwap}
                                disabled={sourceLang === 'AUTO' || isLoading}
                                className="shrink-0"
                            >
                                <ArrowLeftRight className="h-4 w-4" />
                                <span className="sr-only">Swap languages</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Swap languages</TooltipContent>
                    </Tooltip>

                    {/* Target language */}
                    <div className="flex-1">
                        <Select
                            value={targetLang}
                            onValueChange={setTargetLang}
                        >
                            <SelectTrigger id="target-language-select">
                                <SelectValue placeholder="Select target language" />
                            </SelectTrigger>
                            <SelectContent>
                                {TARGET_LANGUAGES.map((lang) => (
                                    <SelectItem key={lang.code} value={lang.code}>
                                        {lang.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Text panels */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                    {/* Source panel */}
                    <Card className="flex flex-col">
                        <CardContent className="flex flex-col gap-2 p-4 h-full">
                            <Textarea
                                id="source-text-input"
                                placeholder="Enter text to translate…"
                                value={sourceText}
                                onChange={(e) => setSourceText(e.target.value.slice(0, MAX_CHARS))}
                                className="flex-1 min-h-[280px] resize-none text-base border-0 shadow-none focus-visible:ring-0 p-0"
                            />
                            <Separator />
                            <div className="flex items-center justify-between pt-1">
                                <span className={`text-xs ${charCount > MAX_CHARS * 0.9 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                                </span>
                                <Button
                                    id="translate-button"
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
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                        Detected: {detectedLang}
                                    </Badge>
                                </div>
                            )}

                            {/* Synonym hint */}
                            {canShowSynonyms && translatedText && !isLoading && (
                                <div className="flex items-center gap-1.5">
                                    <Badge variant="secondary" className="text-[11px] gap-1 font-normal">
                                        <Replace className="h-3 w-3" />
                                        Click any word for synonyms
                                    </Badge>
                                </div>
                            )}

                            <div className="flex-1 relative min-h-[280px]">
                                {isLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : translatedText ? (
                                    <TranslatedText
                                        text={translatedText}
                                        canShowSynonyms={canShowSynonyms}
                                        onTextChange={setTranslatedText}
                                    />
                                ) : (
                                    <p className="text-base whitespace-pre-wrap leading-relaxed text-muted-foreground italic">
                                        Translation will appear here…
                                    </p>
                                )}
                            </div>
                            <Separator />
                            <div className="flex items-center justify-end pt-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            id="copy-translation-button"
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
                                    </TooltipTrigger>
                                    <TooltipContent>Copy translation to clipboard</TooltipContent>
                                </Tooltip>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

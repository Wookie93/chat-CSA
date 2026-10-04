'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export function useTranslation(sourceText: string, sourceLang: string, targetLang: string) {
  const [translatedText, setTranslatedText] = useState('');
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTranslate = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setTranslatedText('');
    setDetectedLang(null);
    setIsLoading(Boolean(sourceText.trim()));
    if (!sourceText.trim()) return;

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText, sourceLang: sourceLang === 'AUTO' ? undefined : sourceLang, targetLang }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (!res.ok) throw new Error(data.error ?? 'Translation failed');
      setTranslatedText(data.translatedText);
      setDetectedLang(data.detectedSourceLang ?? null);
    } catch (error) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        toast.error(error instanceof Error ? error.message : 'Translation failed');
      }
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setIsLoading(false);
    }
  }, [sourceText, sourceLang, targetLang]);

  useEffect(() => {
    // Invalidate the old response immediately, including the debounce interval.
    requestRef.current?.abort();
    timerRef.current = setTimeout(() => { void handleTranslate(); }, sourceText.trim() ? 1000 : 0);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestRef.current?.abort();
    };
  }, [handleTranslate, sourceText]);

  return { translatedText, setTranslatedText, detectedLang, setDetectedLang, isLoading, handleTranslate };
}

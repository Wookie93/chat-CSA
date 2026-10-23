'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export function useTranslation(sourceText: string, sourceLang: string, targetLang: string) {
  const inputKey = JSON.stringify([sourceText, sourceLang, targetLang]);
  const [result, setResult] = useState<{ inputKey: string; text: string; detectedLang: string | null } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // Hide stale results during render, before the effect starts the debounce timer.
  const currentResult = result?.inputKey === inputKey ? result : null;
  const translatedText = currentResult?.text ?? '';
  const detectedLang = currentResult?.detectedLang ?? null;
  const isLoading = loadingKey === inputKey;
  const setTranslatedText = useCallback((text: string) => {
    setResult(previous => previous?.inputKey === inputKey ? { ...previous, text } : previous);
  }, [inputKey]);
  const requestRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTranslate = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setResult(null);
    setLoadingKey(sourceText.trim() ? inputKey : null);
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
      setResult({ inputKey, text: data.translatedText, detectedLang: data.detectedSourceLang ?? null });
    } catch (error) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        toast.error(error instanceof Error ? error.message : 'Translation failed');
      }
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoadingKey(null);
    }
  }, [sourceText, sourceLang, targetLang, inputKey]);

  useEffect(() => {
    // Invalidate the old response immediately, including the debounce interval.
    requestRef.current?.abort();
    timerRef.current = setTimeout(() => { void handleTranslate(); }, sourceText.trim() ? 1000 : 0);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestRef.current?.abort();
    };
  }, [handleTranslate, sourceText]);

  return { translatedText, setTranslatedText, detectedLang, isLoading, handleTranslate };
}

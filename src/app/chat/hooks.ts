'use client';

import { useState, useRef, useCallback, useEffect, type SetStateAction } from 'react';
import { readChatStream } from '@/lib/chat-stream';
import type { Message } from './types';

interface UseChatOptions { onError?: (error: Error) => void }

export function useChat({ onError }: UseChatOptions = {}) {
    const [messages, setMessageState] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesRef = useRef<Message[]>([]);
    const activeRef = useRef<{ controller: AbortController; done: Promise<void> } | null>(null);

    const setMessages = useCallback((update: SetStateAction<Message[]>) => {
        const next = typeof update === 'function' ? update(messagesRef.current) : update;
        messagesRef.current = next;
        setMessageState(next);
    }, []);

    useEffect(() => () => { activeRef.current?.controller.abort(); }, []);

    const sendMessage = useCallback((content: string) => {
        if (!content.trim() || activeRef.current) return;
        const userMessage: Message = {
            id: crypto.randomUUID(), role: 'user', content: content.trim(), createdAt: new Date(),
        };
        const history = [...messagesRef.current, userMessage];
        setMessages(history);
        setInput('');
        setIsLoading(true);
        const controller = new AbortController();
        const assistantId = crypto.randomUUID();
        const active = { controller, done: Promise.resolve() };
        activeRef.current = active;

        active.done = (async () => {
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: history.filter(msg => msg.content.trim()).map(({ role, content }) => ({ role, content })) }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => null);
                    throw new Error(body?.error ?? 'Nie udało się wysłać wiadomości.');
                }
                if (controller.signal.aborted) return;
                if (!response.body) throw new Error('Brak odpowiedzi serwera.');
                setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', createdAt: new Date() }]);
                await readChatStream(response.body, text => {
                    if (controller.signal.aborted) return;
                    setMessages(prev => prev.map(msg => msg.id === assistantId ? { ...msg, content: msg.content + text } : msg));
                });
            } catch (error) {
                if (!controller.signal.aborted) onError?.(error instanceof Error ? error : new Error('Unknown error'));
            } finally {
                if (activeRef.current === active) {
                    setMessages(prev => prev.filter(msg => msg.id !== assistantId || msg.content.length > 0));
                    setIsLoading(false);
                    activeRef.current = null;
                }
            }
        })();
    }, [onError, setMessages]);

    const handleSubmit = useCallback((event?: { preventDefault?: () => void }) => {
        event?.preventDefault?.();
        sendMessage(input);
    }, [input, sendMessage]);
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value), []);
    const append = useCallback((message: { role: 'user'; content: string }) => sendMessage(message.content), [sendMessage]);
    const stop = useCallback(async () => {
        const active = activeRef.current;
        if (!active) return;
        active.controller.abort();
        await active.done;
    }, []);

    return { messages, input, setInput, handleInputChange, isLoading, isGenerating: isLoading,
        handleSubmit, append, stop, cancelRequest: stop, setMessages };
}

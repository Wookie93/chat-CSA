'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message } from './types';

interface UseChatOptions {
    onError?: (error: Error) => void;
}

export function useChat({ onError }: UseChatOptions = {}) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: content.trim(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [...messages, userMessage].map(msg => ({
                        role: msg.role,
                        content: msg.content,
                    })),
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to send message: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '',
            };

            setMessages(prev => [...prev, assistantMessage]);

            const decoder = new TextDecoder();
            let buffer = '';
            let totalContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                for (const line of lines.slice(0, -1)) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                totalContent += parsed.content;
                                setMessages(prev =>
                                    prev.map(msg =>
                                        msg.id === assistantMessage.id
                                            ? { ...msg, content: totalContent }
                                            : msg
                                    )
                                );
                            }
                        } catch {
                            // Try treating as raw text
                            if (data && data !== '[DONE]') {
                                totalContent += data;
                                setMessages(prev =>
                                    prev.map(msg =>
                                        msg.id === assistantMessage.id
                                            ? { ...msg, content: totalContent }
                                            : msg
                                    )
                                );
                            }
                        }
                    } else if (line.trim()) {
                        // Handle raw text lines
                        totalContent += line + '\n';
                        setMessages(prev =>
                            prev.map(msg =>
                                msg.id === assistantMessage.id
                                    ? { ...msg, content: totalContent }
                                    : msg
                            )
                        );
                    }
                }

                buffer = lines[lines.length - 1];
            }

            // Process any remaining buffer content
            if (buffer) {
                // Try to parse as data if it looks like one, otherwise treat as text
                if (buffer.startsWith('data: ')) {
                    const data = buffer.slice(6);
                    if (data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                totalContent += parsed.content;
                            }
                        } catch {
                            // Ignore malformed/partial JSON at the very end
                        }
                    }
                } else {
                    totalContent += buffer;
                }

                // Final update
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === assistantMessage.id
                            ? { ...msg, content: totalContent }
                            : msg
                    )
                );
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                return; // Request was cancelled
            }
            onError?.(error instanceof Error ? error : new Error('Unknown error'));
            // Remove failed assistant message
            setMessages(prev => prev.filter(msg => msg.role === 'user' || msg.content.length > 0));
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    }, [messages, isLoading, onError]);

    const handleSubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault();
        sendMessage(input);
    }, [input, sendMessage]);

    const cancelRequest = useCallback(() => {
        abortControllerRef.current?.abort();
    }, []);

    return {
        messages,
        input,
        setInput,
        isLoading,
        handleSubmit,
        cancelRequest,
        setMessages,
    };
}

export function useAutoScroll(deps: unknown[]) {
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const scrollToBottom = () => {
            if (scrollAreaRef.current) {
                const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
                if (scrollElement) {
                    scrollElement.scrollTop = scrollElement.scrollHeight;
                } else {
                    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
                }
            }
        };

        const timeoutId = setTimeout(scrollToBottom, 50);
        return () => clearTimeout(timeoutId);
    }, deps);

    return scrollAreaRef;
}

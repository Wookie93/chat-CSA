'use client';

import { useCallback, useTransition } from 'react';
import { PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChatContainer, ChatForm, ChatMessages } from '@/components/ui/chat';
import { type Message } from '@/components/ui/chat-message';
import { CopyButton } from '@/components/ui/copy-button';
import { MessageInput } from '@/components/ui/message-input';
import { MessageList } from '@/components/ui/message-list';
import { useChat } from '@/app/chat/hooks';
import { ReplyTemplates } from '@/components/ReplyTemplates';
import { changeCalculatorMode } from '@/lib/actions';

export function ChatInterface({ calculatorMode = 'llm' }: { calculatorMode?: 'llm' | 'jev' }) {
    const [isChangingMode, startModeTransition] = useTransition();
    const handleModeChange = (mode: 'llm' | 'jev') => {
        if (mode === calculatorMode) return;
        startModeTransition(async () => {
            try {
                const result = await changeCalculatorMode(mode);
                if (!result.success) toast.error(result.error);
            } catch {
                toast.error('Nie udało się zmienić trybu. Spróbuj ponownie.');
            }
        });
    };

    const {
        messages,
        input,
        setInput,
        handleInputChange,
        handleSubmit,
        stop,
        isGenerating,
        setMessages,
    } = useChat({
        onError: (error) => toast.error(error.message),
    });

    const lastMessage = messages.at(-1);
    const isTyping = isGenerating && lastMessage?.role === 'user';

    const handleNewChat = async () => {
        await stop();
        setMessages([]);
        setInput('');
    };

    const messageOptions = useCallback(
        (message: Message) => ({
            actions:
                message.role === 'assistant' ? (
                    <CopyButton content={message.content} copyMessage="Skopiowano odpowiedź!" />
                ) : undefined,
        }),
        []
    );

    return (
        <div className="grid h-full min-h-0 w-full grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-1 lg:gap-0">
        <section aria-label="Czat" className="flex min-h-0 min-w-0 flex-col lg:pr-5">
            <div className="flex items-center justify-between pb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg font-medium">Chat</h1>
                    <select
                        aria-label="Tryb czatu"
                        aria-busy={isChangingMode}
                        value={calculatorMode}
                        onChange={(event) => handleModeChange(event.target.value as 'llm' | 'jev')}
                        disabled={isChangingMode || isGenerating}
                        className="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                    >
                        <option value="llm">Tryb: LLM</option>
                        <option value="jev">Tryb: Jev + kalkulator</option>
                    </select>
                    {isChangingMode && <span role="status" className="text-xs text-muted-foreground">Zapisywanie…</span>}
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            id="new-chat-button"
                            variant="ghost"
                            size="sm"
                            onClick={handleNewChat}
                            className="h-8 gap-2 text-muted-foreground hover:text-primary"
                        >
                            <PlusCircle className="h-4 w-4" />
                            <span className="sr-only sm:not-sr-only sm:inline-block">New Chat</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Start a new conversation</TooltipContent>
                </Tooltip>
            </div>

            <ChatContainer className="flex-1 min-h-0 grid-rows-[minmax(0,1fr)_auto]">
                <ChatMessages messages={messages}>
                    <MessageList
                        messages={messages}
                        isTyping={isTyping}
                        messageOptions={messageOptions}
                    />
                </ChatMessages>

                <ChatForm className="mt-auto pt-2" isPending={isGenerating || isChangingMode} handleSubmit={(event) => {
                    if (isChangingMode) { event?.preventDefault?.(); return; }
                    return handleSubmit(event);
                }}>
                    {() => (
                        <MessageInput
                            id="chat-message-input"
                            value={input}
                            onChange={handleInputChange}
                            placeholder="Napisz wiadomość... (Shift+Enter – nowa linia)"
                            stop={stop}
                            isGenerating={isGenerating}
                        />
                    )}
                </ChatForm>
            </ChatContainer>
        </section>
        <ReplyTemplates />
        </div>
    );
}

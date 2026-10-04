'use client';

import { useCallback } from 'react';
import { PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChatContainer, ChatForm, ChatMessages } from '@/components/ui/chat';
import { type Message } from '@/components/ui/chat-message';
import { CopyButton } from '@/components/ui/copy-button';
import { MessageInput } from '@/components/ui/message-input';
import { MessageList } from '@/components/ui/message-list';
import { PromptSuggestions } from '@/components/ui/prompt-suggestions';
import { useChat } from '@/app/chat/hooks';

const SUGGESTIONS = [
    'Jakie pakiety są dostępne i czym się różnią?',
    'Który pakiet polecasz na początek?',
    'Jak wygląda kwestia transportu?',
];

export function ChatInterface() {
    const {
        messages,
        input,
        setInput,
        handleInputChange,
        handleSubmit,
        append,
        stop,
        isGenerating,
        setMessages,
    } = useChat({
        onError: (error) => toast.error(error.message),
    });

    const lastMessage = messages.at(-1);
    const isEmpty = messages.length === 0;
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
        <div className="flex h-full w-full max-w-5xl mx-auto flex-col min-h-0">
            <div className="flex items-center justify-between pb-3">
                <h1 className="text-lg font-medium">Chat</h1>
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
                {isEmpty ? (
                    <div className="flex items-center justify-center px-2">
                        <PromptSuggestions
                            label="Od czego zaczniemy? ✨"
                            append={append}
                            suggestions={SUGGESTIONS}
                        />
                    </div>
                ) : (
                    <ChatMessages messages={messages}>
                        <MessageList
                            messages={messages}
                            isTyping={isTyping}
                            messageOptions={messageOptions}
                        />
                    </ChatMessages>
                )}

                <ChatForm className="mt-auto pt-2" isPending={isGenerating} handleSubmit={handleSubmit}>
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
        </div>
    );
}

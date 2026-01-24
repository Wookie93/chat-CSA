'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useChat, useAutoScroll } from '@/app/chat/hooks';
import { ChatMessage, ChatMessageLoading } from '@/app/chat/ChatMessage';
import { ChatInput } from '@/app/chat/ChatInput';

export function ChatInterface() {
    const {
        messages,
        input,
        setInput,
        isLoading,
        handleSubmit,
        setMessages,
    } = useChat({
        onError: () => toast.error('Failed to send message. Please try again.'),
    });

    const scrollAreaRef = useAutoScroll([messages]);

    const handleNewChat = () => {
        setMessages([]);
        setInput('');
    };

    return (
        <Card className="h-[80vh] flex flex-col w-full max-w-5xl mx-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between py-3 border-b">
                <CardTitle className="text-lg font-medium">Chat</CardTitle>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNewChat}
                    className="h-8 gap-2 text-muted-foreground hover:text-primary"
                >
                    <PlusCircle className="h-4 w-4" />
                    <span className="sr-only sm:not-sr-only sm:inline-block">New Chat</span>
                </Button>
            </CardHeader>
            <CardContent className="flex-1 p-4 overflow-hidden">
                <ScrollArea className="h-full pr-4" ref={scrollAreaRef}>
                    <div className="space-y-4 pb-4">
                        {messages.map((message) => (
                            <ChatMessage key={message.id} message={message} />
                        ))}
                        {isLoading && <ChatMessageLoading />}
                        {messages.length === 0 && !isLoading && (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 pt-20">
                                <p className="text-lg font-medium">Start a conversation</p>
                                <p className="text-sm">Type a message below to begin</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>

            <div className="p-4 border-t bg-muted/20">
                <ChatInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    disabled={isLoading}
                />
            </div>
        </Card>
    );
}

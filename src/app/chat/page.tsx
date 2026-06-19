'use client';

import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useChat, useAutoScroll } from './hooks';
import { ChatMessage, ChatMessageLoading } from './ChatMessage';
import { ChatInput } from './ChatInput';

export default function ChatPage() {
  const {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
  } = useChat({
    onError: () => toast.error('Failed to send message. Please try again.'),
  });

  const scrollAreaRef = useAutoScroll([messages]);

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Chat</h1>

      <Card className="h-[80vh] flex flex-col">
        <CardContent className="flex-1 p-4 overflow-hidden">
          <ScrollArea className="h-full" ref={scrollAreaRef}>
            <div className="space-y-4 pb-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && <ChatMessageLoading />}
            </div>
          </ScrollArea>
        </CardContent>

        <Separator />
        <div className="p-4">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={isLoading}
          />
        </div>
      </Card>
    </div>
  );
}
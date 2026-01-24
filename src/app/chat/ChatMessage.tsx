'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from './types';

const MAX_MESSAGE_LENGTH = 1000;

interface ChatMessageProps {
    message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const needsTruncation = message.content.length > MAX_MESSAGE_LENGTH;
    const displayContent = isExpanded
        ? message.content
        : message.content.substring(0, MAX_MESSAGE_LENGTH).trim();

    const isUser = message.role === 'user';

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className={`max-w-[70%] rounded-lg px-4 py-2 ${isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                    }`}
            >
                <div className="text-sm leading-relaxed space-y-2">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }: any) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                            ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                            li: ({ children }: any) => <li>{children}</li>,
                            h1: ({ children }: any) => <h1 className="text-lg font-bold mb-2 mt-4 first:mt-0">{children}</h1>,
                            h2: ({ children }: any) => <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
                            h3: ({ children }: any) => <h3 className="text-sm font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
                            blockquote: ({ children }: any) => <blockquote className="border-l-2 border-primary/50 pl-4 italic my-2">{children}</blockquote>,
                            a: ({ children, href }: any) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">{children}</a>,
                            code: ({ children, className, node, ...props }: any) => {
                                const match = /language-(\w+)/.exec(className || '');
                                const isInline = !match && !String(children).includes('\n');

                                if (isInline) {
                                    return (
                                        <code className={`bg-muted px-1.5 py-0.5 rounded text-sm font-mono ${className}`} {...props}>
                                            {children}
                                        </code>
                                    );
                                }

                                return (
                                    <div className="my-3 rounded-lg overflow-hidden bg-muted/50 border">
                                        <div className="bg-muted px-4 py-1 text-xs text-muted-foreground border-b flex items-center justify-between">
                                            <span>{match?.[1] || 'code'}</span>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <code className={`block text-sm font-mono ${className}`} {...props}>
                                                {children}
                                            </code>
                                        </div>
                                    </div>
                                );
                            },
                            table: ({ children }: any) => <div className="overflow-x-auto my-4"><table className="min-w-full divide-y divide-border border">{children}</table></div>,
                            thead: ({ children }: any) => <thead className="bg-muted">{children}</thead>,
                            tbody: ({ children }: any) => <tbody className="divide-y divide-border">{children}</tbody>,
                            tr: ({ children }: any) => <tr>{children}</tr>,
                            th: ({ children }: any) => <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{children}</th>,
                            td: ({ children }: any) => <td className="px-3 py-2 text-sm whitespace-nowrap">{children}</td>,
                        }}
                    >
                        {displayContent}
                    </ReactMarkdown>
                </div>
                {needsTruncation && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className={`ml-2 text-xs underline hover:no-underline ${isUser
                            ? 'text-primary-foreground/70 hover:text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                )}
            </div>
        </div>
    );
}

export function ChatMessageLoading() {
    return (
        <div className="flex justify-start">
            <div className="bg-muted text-foreground rounded-lg px-4 py-2">
                Thinking...
            </div>
        </div>
    );
}

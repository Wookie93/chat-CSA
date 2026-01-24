import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function ChatLoading() {
    return (
        <div className="container mx-auto py-8 max-w-4xl">
            <div className="h-8 w-24 bg-muted rounded animate-pulse mb-6" />

            <Card className="h-[600px] flex flex-col">
                <CardContent className="flex-1 p-4 overflow-hidden">
                    <div className="space-y-4 pb-4">
                        {/* Skeleton messages */}
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`rounded-lg px-4 py-2 bg-muted animate-pulse ${i % 2 === 0 ? 'w-[40%]' : 'w-[60%]'
                                        } h-12`}
                                />
                            </div>
                        ))}
                    </div>
                </CardContent>

                <div className="p-4 border-t">
                    <div className="flex gap-2">
                        <div className="flex-1 h-10 bg-muted rounded animate-pulse" />
                        <div className="w-16 h-10 bg-muted rounded animate-pulse" />
                    </div>
                </div>
            </Card>
        </div>
    );
}

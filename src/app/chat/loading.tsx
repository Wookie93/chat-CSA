import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
    return (
        <div className="container mx-auto py-8 max-w-4xl">
            <Skeleton className="h-8 w-24 mb-6" />

            <Card className="h-[600px] flex flex-col">
                <CardContent className="flex-1 p-4 overflow-hidden">
                    <div className="space-y-4 pb-4">
                        {/* Skeleton messages */}
                        {[1, 2, 3].map((i) => (
                            <div
                                key={i}
                                className={`flex gap-3 ${i % 2 === 0 ? 'flex-row-reverse' : 'flex-row'}`}
                            >
                                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                                <div className="space-y-2 flex-1 max-w-[60%]">
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-3/4" />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>

                <Separator />
                <div className="p-4">
                    <div className="flex gap-2">
                        <Skeleton className="flex-1 h-10" />
                        <Skeleton className="w-10 h-10" />
                    </div>
                </div>
            </Card>
        </div>
    );
}

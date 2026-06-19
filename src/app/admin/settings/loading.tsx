import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminSettingsLoading() {
    return (
        <div className="container mx-auto py-8">
            <Skeleton className="h-8 w-40 mb-6" />

            <Card className="max-w-2xl">
                <CardHeader>
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-72 mt-1" />
                </CardHeader>
                <Separator />
                <CardContent className="space-y-6 pt-6">
                    {/* Form field skeletons */}
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className={`w-full ${i === 3 ? 'h-24' : 'h-10'}`} />
                            <Skeleton className="h-3 w-56" />
                        </div>
                    ))}
                    <Skeleton className="h-10 w-36" />
                </CardContent>
            </Card>
        </div>
    );
}

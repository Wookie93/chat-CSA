import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function AdminSettingsLoading() {
    return (
        <div className="container mx-auto py-8">
            <div className="h-8 w-40 bg-muted rounded animate-pulse mb-6" />

            <Card className="max-w-2xl">
                <CardHeader>
                    <div className="h-6 w-48 bg-muted rounded animate-pulse" />
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Form field skeletons */}
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="space-y-2">
                            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                            <div className={`h-10 bg-muted rounded animate-pulse ${i === 4 ? 'h-24' : ''}`} />
                        </div>
                    ))}
                    <div className="h-10 w-32 bg-muted rounded animate-pulse" />
                </CardContent>
            </Card>
        </div>
    );
}

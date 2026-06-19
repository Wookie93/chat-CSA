'use client';

import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="container mx-auto py-16 max-w-md">
                    <Card className="border-destructive">
                        <CardHeader className="flex flex-row items-start gap-3">
                            <div className="rounded-full bg-destructive/10 p-2">
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                            </div>
                            <div className="flex-1">
                                <CardTitle className="text-destructive">Something went wrong</CardTitle>
                                <CardDescription>
                                    An unexpected error occurred while rendering this page.
                                </CardDescription>
                            </div>
                        </CardHeader>
                        <Separator />
                        <CardContent className="space-y-4 pt-4">
                            <p className="text-sm text-muted-foreground font-mono bg-muted p-3 rounded-md">
                                {this.state.error?.message || 'An unexpected error occurred.'}
                            </p>
                            <Button onClick={this.handleReset} variant="outline" className="gap-2">
                                <RotateCcw className="h-4 w-4" />
                                Try again
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}

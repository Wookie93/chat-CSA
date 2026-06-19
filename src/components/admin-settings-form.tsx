'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateSettingsSchema, type UpdateSettingsInput } from '@/lib/schemas';
import { updateSettings } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

interface AdminSettingsFormProps {
    initialSettings: {
        openrouter_api_key: string;
        openrouter_model: string;
        system_prompt: string;
    };
}

export function AdminSettingsForm({ initialSettings }: AdminSettingsFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const form = useForm<UpdateSettingsInput>({
        resolver: zodResolver(updateSettingsSchema),
        defaultValues: initialSettings,
    });

    const onSubmit = async (data: UpdateSettingsInput) => {
        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('openrouter_api_key', data.openrouter_api_key);
            formData.append('openrouter_model', data.openrouter_model);
            formData.append('system_prompt', data.system_prompt);

            const result = await updateSettings(formData);

            if (result.success) {
                toast.success('Settings updated successfully!');
            } else {
                if (result.errors) {
                    result.errors.forEach((error) => {
                        toast.error(`${error.field}: ${error.message}`);
                    });
                } else {
                    toast.error(result.error || 'Failed to update settings');
                }
            }
        } catch (error) {
            toast.error('An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card className="max-w-2xl">
            <CardHeader>
                <CardTitle>Chat Configuration</CardTitle>
                <CardDescription>
                    Manage your AI chat settings, API keys, and system prompts.
                </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-6">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <FormField
                            control={form.control}
                            name="openrouter_api_key"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>OpenRouter API Key</FormLabel>
                                    <FormControl>
                                        <Input
                                            id="openrouter-api-key-input"
                                            type="password"
                                            placeholder="sk-or-v1-..."
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Your OpenRouter API key for accessing AI models.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="openrouter_model"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Primary Model</FormLabel>
                                    <FormControl>
                                        <Input
                                            id="openrouter-model-input"
                                            placeholder="openai/gpt-4o-mini"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        The AI model identifier to use for chat responses.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="system_prompt"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>System Prompt</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            id="system-prompt-input"
                                            placeholder="You are a helpful AI assistant..."
                                            rows={4}
                                            className="resize-none"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Instructions for the AI that define its behavior and personality.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <Button
                            id="save-settings-button"
                            type="submit"
                            disabled={isSubmitting}
                            className="gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4" />
                                    Save Settings
                                </>
                            )}
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateSettingsSchema, type UpdateSettingsInput } from '@/lib/schemas';
import { updateSettings } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

interface AdminSettingsFormProps {
  initialSettings: {
    openrouter_api_key: string;
    openrouter_model: string;
    system_prompt: string;
  };
}

export function AdminSettingsForm({ initialSettings }: AdminSettingsFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateSettingsInput>({
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
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="openrouter_api_key">OpenRouter API Key</Label>
            <Input
              id="openrouter_api_key"
              type="password"
              {...register('openrouter_api_key')}
              placeholder="sk-or-v1-..."
            />
            {errors.openrouter_api_key && (
              <p className="text-sm text-red-600 mt-1">
                {errors.openrouter_api_key.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="openrouter_model">Primary Model</Label>
            <Input
              id="openrouter_model"
              {...register('openrouter_model')}
              placeholder="openai/gpt-4o-mini"
            />
            {errors.openrouter_model && (
              <p className="text-sm text-red-600 mt-1">
                {errors.openrouter_model.message}
              </p>
            )}
          </div>



          <div>
            <Label htmlFor="system_prompt">System Prompt</Label>
            <Textarea
              id="system_prompt"
              {...register('system_prompt')}
              placeholder="You are a helpful AI assistant..."
              rows={4}
            />
            {errors.system_prompt && (
              <p className="text-sm text-red-600 mt-1">
                {errors.system_prompt.message}
              </p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
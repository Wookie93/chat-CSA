import { getAppSettings } from '@/lib/supabase';
import { ChatInterface } from '@/components/ChatInterface';

export default async function ChatPage() {
  const settings = await getAppSettings();
  return (
    <div className="flex-1 flex min-h-0">
      <ChatInterface calculatorMode={settings.calculator_mode ?? 'llm'} />
    </div>
  );
}
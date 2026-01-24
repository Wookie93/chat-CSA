import Link from 'next/link';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatInterface } from '@/components/ChatInterface';

export default function Home() {
  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Admin Button - Top Left */}
      <div className="absolute top-4 left-4 z-50">
        <Link href="/admin/settings">
          <Button variant="outline" size="icon" className="bg-background/80 backdrop-blur-sm shadow-sm hover:bg-muted" title="Admin Settings">
            <Settings className="h-5 w-5" />
            <span className="sr-only">Admin Settings</span>
          </Button>
        </Link>
      </div>

      {/* Main Content */}
      <div className="container mx-auto py-8 px-4 flex-1 flex flex-col">
        <div className="text-center mb-8 pt-8">
          <h1 className="text-3xl font-bold mb-2">Chat Application</h1>
          <p className="text-muted-foreground">
            A secure, dynamic chat application powered by AI
          </p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <ChatInterface />
        </div>
      </div>
    </div>
  );
}

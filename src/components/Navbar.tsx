'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Languages, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
    {
        href: '/',
        icon: MessageSquare,
        label: 'Chat',
    },
    {
        href: '/translator',
        icon: Languages,
        label: 'Translator',
    },
    {
        href: '/admin/settings',
        icon: Settings,
        label: 'Settings',
    },
];

export function Navbar() {
    const pathname = usePathname();

    return (
        <nav id="main-navbar" className="flex items-center gap-1 px-12 h-14 bg-background border-b border-border">
            <div className="flex items-center gap-1">
                {navItems.map((item) => {
                    const isActive =
                        item.href === '/'
                            ? pathname === '/'
                            : pathname.startsWith(item.href);

                    return (
                        <Tooltip key={item.href}>
                            <TooltipTrigger asChild>
                                <Link href={item.href}>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={`h-9 w-9 transition-colors ${
                                            isActive
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                        }`}
                                    >
                                        <item.icon className="h-5 w-5" />
                                        <span className="sr-only">{item.label}</span>
                                    </Button>
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{item.label}</TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </nav>
    );
}

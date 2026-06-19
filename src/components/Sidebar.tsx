'use client';

import { useState } from 'react';
import { ChevronRight, Truck, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface PackageItem {
    id: string;
    name: string;
    tier: string;
    price: number;
}

const PACKAGES: PackageItem[] = [
    { id: 'pkg-1', name: 'Pakiet I',   tier: 'Basic',       price: 200 },
    { id: 'pkg-2', name: 'Pakiet II',  tier: 'Basic +',     price: 250 },
    { id: 'pkg-3', name: 'Pakiet III', tier: 'Premium',     price: 320 },
    { id: 'pkg-4', name: 'Pakiet IV',  tier: 'Premium +',   price: 380 },
    { id: 'pkg-5', name: 'Pakiet V',   tier: 'VIP',         price: 430 },
    { id: 'pkg-6', name: 'Pakiet VI',  tier: 'Like a king', price: 500 },
    { id: 'pkg-7', name: 'Pakiet VII', tier: 'Badass',      price: 550 },
];

function PackageList() {
    return (
        <ul className="space-y-1 py-1">
            {PACKAGES.map((pkg) => (
                <li key={pkg.id}>
                    <button
                        id={`sidebar-package-${pkg.id}`}
                        className="sidebar-package-item"
                    >
                        <div className="flex flex-col gap-0.5 text-left min-w-0">
                            <span className="text-sm font-medium truncate">
                                {pkg.name}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                {pkg.tier}
                            </span>
                        </div>
                        <Badge variant="secondary" className="text-[11px] shrink-0 font-semibold tabular-nums">
                            {pkg.price} PLN
                        </Badge>
                    </button>
                </li>
            ))}
        </ul>
    );
}

interface SidebarSection {
    id: string;
    label: string;
    icon: React.ElementType;
    children?: React.ReactNode;
}

const sections: SidebarSection[] = [
    {
        id: 'transport',
        label: 'Transport',
        icon: Truck,
    },
    {
        id: 'pakiety',
        label: 'Pakiety',
        icon: Package,
        children: <PackageList />,
    },
];

export function Sidebar() {
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

    const toggleSection = (id: string) => {
        setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <aside
            id="main-sidebar"
            className="w-56 shrink-0 bg-background overflow-y-auto"
        >
            <div className="pt-4 pb-3 px-2 space-y-1">
                {sections.map((section) => (
                    <Collapsible
                        key={section.id}
                        open={openSections[section.id] || false}
                        onOpenChange={() => toggleSection(section.id)}
                    >
                        <CollapsibleTrigger asChild>
                            <Button
                                id={`sidebar-section-${section.id}`}
                                variant="ghost"
                                className="w-full justify-between h-[3.15rem] px-3 text-lg font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                            >
                                <span className="flex items-center gap-2">
                                    <section.icon className="h-6 w-6" />
                                    {section.label}
                                </span>
                                <ChevronRight
                                    className={`h-6 w-6 transition-transform duration-200 ${
                                        openSections[section.id] ? 'rotate-90' : ''
                                    }`}
                                />
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pl-6 pr-2 py-1">
                            {section.children || (
                                <p className="text-xs text-muted-foreground/60 py-2 px-2">
                                    Brak elementów
                                </p>
                            )}
                        </CollapsibleContent>
                    </Collapsible>
                ))}
            </div>
        </aside>
    );
}

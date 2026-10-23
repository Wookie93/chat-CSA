'use client';

import { Accordion } from 'radix-ui';
import { ChevronDown, Truck, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
    return (
        <aside
            id="main-sidebar"
            aria-label="Transport i pakiety"
            className="w-56 shrink-0 bg-background overflow-y-auto"
        >
            <Accordion.Root type="multiple" className="space-y-2 px-4 pt-4 pb-3">
                {sections.map((section) => (
                    <Accordion.Item
                        key={section.id}
                        value={section.id}
                        className="overflow-hidden rounded-xl border bg-background"
                    >
                        <Accordion.Header>
                            <Accordion.Trigger
                                id={`sidebar-section-${section.id}`}
                                className="group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                            >
                                <span className="flex min-w-0 items-center gap-2">
                                    <section.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    {section.label}
                                </span>
                                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                            </Accordion.Trigger>
                        </Accordion.Header>
                        <Accordion.Content className="border-t px-3 pt-3 pb-3">
                            {section.children || (
                                <p className="text-sm text-muted-foreground">Brak elementów</p>
                            )}
                        </Accordion.Content>
                    </Accordion.Item>
                ))}
            </Accordion.Root>
        </aside>
    );
}

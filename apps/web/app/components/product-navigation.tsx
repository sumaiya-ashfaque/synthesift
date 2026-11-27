import Link from 'next/link';
import { Database, FolderKanban, KeyRound, Layers, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

type Destination = 'overview' | 'library' | 'workbench' | 'governance' | 'manage-data';

type Props = { current: Destination };

const destinations: ReadonlyArray<{
  key: Destination;
  href: string;
  label: string;
  Icon: typeof FolderKanban;
}> = [
  { key: 'overview', href: '/workspaces', label: 'Overview', Icon: FolderKanban },
  { key: 'workbench', href: '/workbench', label: 'Data workbench', Icon: Layers },
  { key: 'library', href: '/dataset-library', label: 'Dataset library', Icon: Database },
  { key: 'governance', href: '/governance', label: 'CI/CD & Governance', Icon: KeyRound },
  { key: 'manage-data', href: '/manage-data', label: 'Manage data', Icon: ShieldCheck },
];

export function ProductNavigation({ current }: Props) {
  return (
    <nav
      aria-label="Primary navigation"
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)]/90 p-1 backdrop-blur-xs"
    >
      {destinations.map(({ key, href, label, Icon }) => {
        const active = current === key;
        return (
          <Link
            href={href}
            key={key}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs transition-all no-underline',
              active
                ? 'bg-[var(--ss-primary)] text-white font-semibold shadow-[0_6px_16px_-6px_rgba(147,0,49,0.65)]'
                : 'text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] font-medium',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

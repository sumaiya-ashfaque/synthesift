import Link from 'next/link';
import { Database, FolderKanban, Layers, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/app/components/theme-toggle';
import { cn } from '@/lib/cn';

type Destination = 'overview' | 'library' | 'workbench' | 'manage-data';

type Props = { current: Destination };

const destinations: ReadonlyArray<{
  key: Destination;
  href: string;
  label: string;
  detail: string;
  Icon: typeof FolderKanban;
}> = [
  {
    key: 'overview',
    href: '/workspaces',
    label: 'Overview',
    detail: 'Workspaces, projects, and uploads',
    Icon: FolderKanban,
  },
  {
    key: 'workbench',
    href: '/workbench',
    label: 'Data workbench',
    detail: 'Interactive Studio, Data Grid, profiling & AI',
    Icon: Layers,
  },
  {
    key: 'library',
    href: '/dataset-library',
    label: 'Dataset library',
    detail: 'Cross-workspace dataset catalog and import',
    Icon: Database,
  },
  {
    key: 'manage-data',
    href: '/manage-data',
    label: 'Manage data',
    detail: 'Team access, roles, and deletion governance',
    Icon: ShieldCheck,
  },
];

export function ProductNavigation({ current }: Props) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary navigation">
      <span className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--ss-subtle)]">
        WORKSPACE
      </span>
      {destinations.map(({ key, href, label, detail, Icon }) => {
        const active = current === key;
        return (
          <Link
            href={href}
            key={key}
            className={cn(
              'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors no-underline',
              active
                ? 'bg-[var(--ss-primary-wash)] text-[var(--ss-primary)] font-semibold'
                : 'text-[var(--ss-muted)] hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] font-medium',
            )}
            aria-current={active ? 'page' : undefined}
            title={detail}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[var(--ss-primary)]"
              />
            )}
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.65} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
      <ThemeToggle />
      <p className="mt-3 px-2.5 pt-2.5 border-t border-[var(--ss-border)] font-mono text-[10px] leading-relaxed text-[var(--ss-subtle)]">
        Evidence first. Every change reviewed.
      </p>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import {
  ChevronRight,
  Database,
  FolderKanban,
  KeyRound,
  Layers,
  LogOut,
  Moon,
  Search,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { Brand } from '@/app/components/brand';
import { ProductNavigation } from '@/app/components/product-navigation';
import { setAppTheme, ThemeToggle } from '@/app/components/theme-toggle';
import type { Account } from '@/lib/client-api';

export type ShellNavKey = 'overview' | 'library' | 'workbench' | 'governance' | 'manage-data';

type QuickJump = {
  id: string;
  label: string;
  group: string;
  meta?: string;
  onSelect: () => void;
};

type Props = {
  current: ShellNavKey;
  breadcrumb: Array<{ label: string; href?: string }>;
  account?: Account | null;
  onSignOut?: () => void;
  sidebarExtra?: ReactNode;
  topbarActions?: ReactNode;
  quickJumps?: QuickJump[];
  children: ReactNode;
};

export function AppShell({
  current,
  breadcrumb,
  account,
  onSignOut,
  sidebarExtra,
  topbarActions,
  quickJumps = [],
  children,
}: Props) {
  const router = useRouter();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCmdOpen((prev) => !prev);
      } else if (event.key === 'Escape') {
        setCmdOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const runCmd = (fn: () => void) => {
    setCmdOpen(false);
    fn();
  };

  const initials = (account?.username || account?.email || 'SS').slice(0, 2).toUpperCase();

  return (
    <div className="ss-studio-canvas min-h-screen flex flex-col text-[var(--ss-text)]">
      {/* Razor-sharp 4-color editorial accent bar */}
      <div className="ss-palette-bar sticky top-0 z-40" aria-hidden="true" />

      {/* Full-Width Floating Top Command Dock — replaces generic sidebar */}
      <header className="sticky top-[3px] z-30 border-b border-[var(--ss-border)]/85 bg-[var(--ss-surface)]/86 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1460px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-4 min-w-0">
            <Brand />
            {breadcrumb.length > 0 && (
              <div className="hidden 2xl:flex items-center gap-1.5 border-l border-[var(--ss-border)] pl-4 text-xs text-[var(--ss-muted)] min-w-0">
                {breadcrumb.map((crumb, idx) => (
                  <span key={`${crumb.label}-${idx}`} className="flex items-center gap-1.5 min-w-0">
                    {idx > 0 && (
                      <ChevronRight className="h-3 w-3 shrink-0 text-[var(--ss-subtle)]" aria-hidden="true" />
                    )}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="truncate text-[var(--ss-muted)] hover:text-[var(--ss-primary)] no-underline"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-[var(--ss-text)]">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Center Floating Pill Navigation */}
          <div className="hidden lg:flex items-center justify-center">
            <ProductNavigation current={current} />
          </div>

          {/* Right Utility Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              title="Command palette (Ctrl+K)"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-3 text-xs text-[var(--ss-muted)] hover:border-[var(--ss-primary-border)] hover:text-[var(--ss-text)] transition-colors"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.7} />
              <kbd className="font-mono text-[10px] text-[var(--ss-subtle)]">⌘K</kbd>
            </button>

            <ThemeToggle />

            {topbarActions}

            {account && (
              <span
                title={account.email || account.username}
                className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ss-warn-wash)] border border-[var(--ss-amber)]/40 font-mono text-[11px] font-semibold text-[var(--ss-burgundy)]"
              >
                {initials}
              </span>
            )}

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 text-xs font-medium text-[var(--ss-muted)] hover:border-[var(--ss-primary-border)] hover:text-[var(--ss-primary)] transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
                <span className="hidden xl:inline">Sign out</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile / Tablet Compact Pill Bar */}
        <div className="lg:hidden border-t border-[var(--ss-border)]/70 px-4 py-2 overflow-x-auto ss-no-scrollbar">
          <ProductNavigation current={current} />
        </div>
      </header>

      {/* Main Full-Bleed Architectural Workspace */}
      <main
        id="main-content"
        className="flex-1 w-full max-w-[1460px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8"
      >
        {sidebarExtra ? (
          <div className="grid grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)] gap-8 items-start">
            <aside className="lg:sticky lg:top-24">{sidebarExtra}</aside>
            <div className="min-w-0">{children}</div>
          </div>
        ) : (
          children
        )}
      </main>

      {/* Global Command Palette (Ctrl/Cmd+K) */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[14vh] px-4 backdrop-blur-[2px]"
          onClick={() => setCmdOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div className="w-full max-w-[540px]" onClick={(e) => e.stopPropagation()}>
            <Command label="SyntheSift Command Palette">
              <Command.Input placeholder="Jump to page, dataset, or action…" autoFocus />
              <Command.List>
                <Command.Empty className="py-8 text-center text-xs text-[var(--ss-muted)]">
                  No matching commands.
                </Command.Empty>

                <Command.Group heading="Navigation">
                  <Command.Item onSelect={() => runCmd(() => router.push('/workspaces'))}>
                    <span className="flex items-center gap-2">
                      <FolderKanban className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Overview
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/workspaces</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/workbench'))}>
                    <span className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Data workbench
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/workbench</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/dataset-library'))}>
                    <span className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Dataset library
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/dataset-library</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/governance'))}>
                    <span className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      CI/CD & Governance
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/governance</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/manage-data'))}>
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Manage data
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/manage-data</span>
                  </Command.Item>
                </Command.Group>

                {quickJumps.length > 0 && (
                  <Command.Group heading="Context">
                    {quickJumps.map((item) => (
                      <Command.Item key={item.id} onSelect={() => runCmd(item.onSelect)}>
                        <span>{item.label}</span>
                        {item.meta && (
                          <span className="font-mono text-[10px] text-[var(--ss-subtle)]">
                            {item.meta}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Appearance">
                  <Command.Item onSelect={() => runCmd(() => setAppTheme('light'))}>
                    <span className="flex items-center gap-2">
                      <Sun className="h-3.5 w-3.5 text-[var(--ss-amber)]" />
                      Light mode
                    </span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => setAppTheme('dark'))}>
                    <span className="flex items-center gap-2">
                      <Moon className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Dark mode
                    </span>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </div>
  );
}

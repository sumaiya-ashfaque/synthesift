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
import { setAppTheme } from '@/app/components/theme-toggle';
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

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] bg-[var(--ss-canvas)] text-[var(--ss-text)]">
      {/* Left Precision Instrument Rail */}
      <aside
        className="flex flex-col border-b md:border-b-0 md:border-r border-[var(--ss-border)] bg-[var(--ss-surface)]"
        aria-label="Workspace navigation"
      >
        <div className="flex h-14 items-center justify-between px-4 border-b border-[var(--ss-border)]">
          <Brand />
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            title="Command palette (Ctrl+K)"
            className="hidden md:inline-flex items-center gap-1 rounded border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ss-muted)] hover:border-[var(--ss-border-strong)] hover:text-[var(--ss-text)]"
          >
            <span>⌘K</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          <ProductNavigation current={current} />
          {sidebarExtra}
        </div>

        <div className="hidden md:flex items-center justify-between px-4 py-3 border-t border-[var(--ss-border)] font-mono text-[10px] text-[var(--ss-subtle)]">
          <span>DUCKDB · POLARS</span>
          <span className="inline-flex items-center gap-1 text-[var(--ss-pass)]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            LOCAL
          </span>
        </div>
      </aside>

      {/* Main Workspace Column */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[var(--ss-border)] bg-[var(--ss-surface)]/95 px-5 lg:px-8 backdrop-blur-xs">
          <div className="flex items-center gap-1.5 min-w-0 text-xs text-[var(--ss-muted)]">
            {breadcrumb.map((crumb, idx) => (
              <span key={`${crumb.label}-${idx}`} className="flex items-center gap-1.5 min-w-0">
                {idx > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ss-subtle)]" aria-hidden="true" />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="truncate text-[var(--ss-muted)] hover:text-[var(--ss-text)] no-underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <strong className="truncate font-semibold text-[var(--ss-text)]">
                    {crumb.label}
                  </strong>
                )}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)] px-2.5 py-1 text-xs text-[var(--ss-muted)] hover:border-[var(--ss-border-strong)] hover:text-[var(--ss-text)]"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.7} />
              <span>Quick jump…</span>
              <kbd className="font-mono text-[10px] text-[var(--ss-subtle)]">⌘K</kbd>
            </button>

            {topbarActions}

            {account && (
              <span
                className="hidden lg:inline-block max-w-[200px] truncate font-mono text-[11px] text-[var(--ss-muted)]"
                title={account.email || account.username}
              >
                {account.email || account.username}
              </span>
            )}

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--ss-text)] hover:bg-[var(--ss-surface-hover)]"
              >
                <LogOut className="h-3.5 w-3.5 text-[var(--ss-muted)]" strokeWidth={1.6} />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </header>

        <main
          id="main-content"
          className="flex-1 w-full max-w-[1520px] mx-auto px-5 lg:px-8 py-6 lg:py-8"
        >
          {children}
        </main>
      </div>

      {/* Global Command Palette (Ctrl/Cmd+K) */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[14vh] px-4 backdrop-blur-[1px]"
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
                      Workspace overview
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/workspaces</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/workbench'))}>
                    <span className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Dataset Studio & Data Grid
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/workbench</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/dataset-library'))}>
                    <span className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Dataset Catalog
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/dataset-library</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/governance'))}>
                    <span className="flex items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      CI/CD Gates, Tokens & Audit Trail
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ss-subtle)]">/governance</span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => router.push('/manage-data'))}>
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Governance & Team Access
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
                      <Sun className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Switch to Alabaster Light
                    </span>
                  </Command.Item>
                  <Command.Item onSelect={() => runCmd(() => setAppTheme('dark'))}>
                    <span className="flex items-center gap-2">
                      <Moon className="h-3.5 w-3.5 text-[var(--ss-muted)]" />
                      Switch to Obsidian Dark
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

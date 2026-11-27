import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/app/components/brand';
import { InteractivePreview } from '@/app/components/landing/interactive-preview';

const CAPABILITIES = [
  {
    num: '01',
    tag: 'DuckDB · Polars',
    tagClass: 'bg-[var(--ss-sky)] text-[var(--ss-sky-deep)]',
    title: 'Profile & PII Guard',
    detail: 'Quantiles, IQR fences, Pearson correlations, and automatic cell redaction across CSV, TSV, Parquet, Excel, and JSON.',
  },
  {
    num: '02',
    tag: '15-Op DSL',
    tagClass: 'bg-[var(--ss-cream)] text-[#7a4600]',
    title: 'Pipelines & Lineage',
    detail: 'Preview exact row and cell diffs, export runnable Polars/Pandas/SQL code, and track every derived version in a Lineage DAG.',
  },
  {
    num: '03',
    tag: 'PSI · KS · YAML',
    tagClass: 'bg-[var(--ss-primary-wash)] text-[var(--ss-primary)]',
    title: 'Drift & Data Contracts',
    detail: 'Catch statistical distribution shift before models degrade and enforce declarative YAML contracts on every drop.',
  },
  {
    num: '04',
    tag: 'HTTP 200 / 422',
    tagClass: 'bg-[var(--ss-amber)]/20 text-[var(--ss-warn)]',
    title: 'CI/CD Gates & AI Evals',
    detail: 'Block bad PRs with workspace PATs, HMAC-signed webhooks, audit logs, and an adversarial guardrail evaluation harness.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--ss-canvas)] text-[var(--ss-text)]">
      <div className="ss-palette-bar sticky top-0 z-40" aria-hidden="true" />

      {/* Floating Editorial Navigation */}
      <header className="sticky top-[3px] z-30 border-b border-[var(--ss-border)]/80 bg-[var(--ss-surface)]/86 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6">
          <Brand />

          <nav className="hidden md:flex items-center gap-1 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)]/90 p-1 text-xs font-medium text-[var(--ss-muted)]">
            <a href="#capabilities" className="rounded-full px-3.5 py-1.5 hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] no-underline transition-colors">
              Capabilities
            </a>
            <Link href="/workbench" className="rounded-full px-3.5 py-1.5 hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] no-underline transition-colors">
              Workbench
            </Link>
            <Link href="/governance" className="rounded-full px-3.5 py-1.5 hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] no-underline transition-colors">
              CI/CD Gates
            </Link>
            <Link href="/api/docs/" className="rounded-full px-3.5 py-1.5 hover:bg-[var(--ss-surface-hover)] hover:text-[var(--ss-text)] no-underline transition-colors">
              API Spec
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-full border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-4 text-xs font-medium text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#930031] to-[#B60A43] px-4 text-xs font-semibold text-white no-underline shadow-[0_8px_20px_-8px_rgba(147,0,49,0.6)] hover:brightness-110 transition-all"
            >
              <span>Open Studio</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Luminous Sculpted Hero */}
      <section className="ss-auth-backdrop relative overflow-hidden border-b border-[var(--ss-border)]">
        <div className="mx-auto max-w-[1280px] px-6 py-16 lg:py-24">
          <div className="mx-auto max-w-3xl text-center space-y-6">
            <h1 className="font-display text-5xl sm:text-[68px] leading-[0.98] text-[var(--ss-text)]">
              Clean data, <em className="italic text-[var(--ss-primary)]">proven</em> to the last cell.
            </h1>

            <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-[var(--ss-muted)]">
              Deterministic profiling, PII masking, safe transformation pipelines, ML drift observability, and headless CI/CD quality gates—in one unified workspace.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Link
                href="/register"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#930031] to-[#B60A43] px-6 text-xs font-semibold text-white no-underline shadow-[0_14px_30px_-10px_rgba(147,0,49,0.65)] hover:brightness-110 transition-all"
              >
                <span>Start workspace</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/workbench"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--ss-border-strong)] bg-[var(--ss-surface)]/90 px-6 text-xs font-semibold text-[var(--ss-text)] no-underline backdrop-blur-xs hover:bg-[var(--ss-surface-hover)] transition-colors"
              >
                <span>Launch Studio</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ss-primary)]" />
              </Link>
            </div>
          </div>

          {/* Sculpted Burgundy Lacquer Showcase Frame around Interactive Preview */}
          <div className="mx-auto mt-14 max-w-[1040px] rounded-[28px] ss-burgundy-stage p-2.5 sm:p-4 shadow-[0_36px_90px_-30px_rgba(147,0,49,0.48)]">
            <InteractivePreview />
          </div>
        </div>
      </section>

      {/* Open Editorial Architectural Index — Zero Cliché Box Grid */}
      <section id="capabilities" className="bg-[var(--ss-surface)]">
        <div className="mx-auto max-w-[1160px] px-6 py-20">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-4xl sm:text-[44px] leading-none text-[var(--ss-text)]">
              Four engines. <em className="italic text-[var(--ss-primary)]">Zero</em> blind spots.
            </h2>
            <Link
              href="/api/docs/"
              className="inline-flex items-center gap-1 font-mono text-xs font-medium text-[var(--ss-primary)] no-underline hover:underline"
            >
              <span>Explore 77 OpenAPI endpoints</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-[var(--ss-border)] border-t border-b border-[var(--ss-border)]">
            {CAPABILITIES.map((item) => (
              <div
                key={item.num}
                className="group grid grid-cols-1 md:grid-cols-12 items-baseline gap-4 py-7 px-3 -mx-3 rounded-2xl hover:bg-[var(--ss-surface-hover)]/65 transition-colors"
              >
                <span className="md:col-span-2 font-display text-4xl text-[var(--ss-primary)]/85">
                  {item.num}
                </span>
                <div className="md:col-span-4 space-y-1.5">
                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--ss-text)]">
                    {item.title}
                  </h3>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${item.tagClass}`}
                  >
                    {item.tag}
                  </span>
                </div>
                <p className="md:col-span-6 text-sm leading-relaxed text-[var(--ss-muted)]">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final Sculpted Burgundy Callout */}
      <section className="px-6 py-16">
        <div className="ss-burgundy-stage mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-6 rounded-[28px] px-8 py-12 text-white shadow-[0_30px_70px_-28px_rgba(147,0,49,0.5)]">
          <div className="max-w-lg space-y-2">
            <h2 className="font-display text-4xl sm:text-[44px] leading-tight text-white">
              Ready to inspect your first <em className="italic text-[#FFF2A7]">dataset?</em>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#FFF2A7] px-6 text-xs font-bold text-[#740026] no-underline hover:brightness-105 transition-all"
            >
              <span>Sign in</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/register"
              className="inline-flex h-11 items-center rounded-full border border-white/25 bg-white/10 px-6 text-xs font-semibold text-white no-underline backdrop-blur-xs hover:bg-white/20 transition-colors"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="border-t border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <div className="mx-auto flex flex-wrap max-w-[1280px] items-center justify-between gap-4 px-6 py-6 font-mono text-[11px] text-[var(--ss-subtle)]">
          <span>SyntheSift</span>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-[var(--ss-primary)] no-underline">
              Sign in
            </Link>
            <Link href="/workbench" className="hover:text-[var(--ss-primary)] no-underline">
              Workbench
            </Link>
            <Link href="/governance" className="hover:text-[var(--ss-primary)] no-underline">
              Governance
            </Link>
            <Link href="/api/docs/" className="hover:text-[var(--ss-primary)] no-underline">
              API Docs
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

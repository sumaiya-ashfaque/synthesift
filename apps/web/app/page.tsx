import Link from 'next/link';
import {
  ArrowRight,
  Database,
  FileCheck2,
  GitBranch,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Brand } from '@/app/components/brand';
import { InteractivePreview } from '@/app/components/landing/interactive-preview';

const GUARANTEES = [
  {
    index: '01',
    title: 'Deterministic Engine',
    body: 'Polars and DuckDB compute exact quantiles, IQR outlier fences, Pearson correlations, and ML drift metrics (PSI, KS, JSD) across CSV, TSV, Parquet, Excel, and JSON.',
    Icon: Database,
    accent: 'bg-[var(--ss-sky)] text-[var(--ss-sky-deep)]',
  },
  {
    index: '02',
    title: 'Zero-Row AI Egress',
    body: 'PII risk is flagged automatically. Only aggregate column schemas and stable evidence IDs (C1, F1) leave the server—raw rows never enter prompts.',
    Icon: Lock,
    accent: 'bg-[var(--ss-cream)] text-[#7a4600]',
  },
  {
    index: '03',
    title: 'Contracts & Safe DSL',
    body: 'Author 10-rule YAML Data Contracts, draft validated 15-op transformation pipelines with cell diffs, and gate pull requests via headless CI/CD APIs.',
    Icon: ShieldCheck,
    accent: 'bg-[var(--ss-primary-wash)] text-[var(--ss-primary)]',
  },
  {
    index: '04',
    title: 'Immutable Provenance',
    body: 'Every uploaded original is SHA-256 verified and never mutated in place. Approved remediations create versioned derived datasets inside a Lineage DAG.',
    Icon: GitBranch,
    accent: 'bg-[var(--ss-amber)]/20 text-[var(--ss-warn)]',
  },
];

const ARCHITECTURE_SPECS = [
  { layer: 'Analytical Engine', stack: 'DuckDB + Polars + PyYAML', detail: 'In-memory SQL grid filtering, 12-bin histograms, Luhn PII scanner, PSI/KS/JSD drift' },
  { layer: 'Application & CI API', stack: 'Django 5.2 + DRF + SSE', detail: 'Session/CSRF & SHA-256 PAT auth, 77 OpenAPI routes, HMAC webhooks, Audit Trail' },
  { layer: 'AI Guardrails & Evals', stack: 'Gemini + Adversarial Harness', detail: '4 prompt paradigms, strict evidence-ID grounding, Copilot-to-DSL drafting' },
  { layer: 'Frontend Studio', stack: 'Next.js 16 + Tailwind v4 + SVG', detail: 'Editorial precision studio, ⌘K palette, inline sparklines, Lineage DAG & /governance' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[var(--ss-canvas)] text-[var(--ss-text)]">
      {/* Top 4-Color Architectural Signature Bar */}
      <div className="ss-palette-bar" aria-hidden="true" />

      {/* Top Architectural Navigation */}
      <header className="sticky top-0 z-30 border-b border-[var(--ss-border)] bg-[var(--ss-surface)]/95 backdrop-blur-xs">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6">
          <Brand />

          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-[var(--ss-muted)]">
            <a href="#guarantees" className="hover:text-[var(--ss-primary)] no-underline transition-colors">
              Guarantees
            </a>
            <a href="#architecture" className="hover:text-[var(--ss-primary)] no-underline transition-colors">
              Architecture
            </a>
            <Link href="/governance" className="hover:text-[var(--ss-primary)] no-underline transition-colors">
              CI/CD Gates
            </Link>
            <Link href="/api/docs/" className="hover:text-[var(--ss-primary)] no-underline transition-colors">
              OpenAPI Spec
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-3.5 text-xs font-medium text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--ss-primary)] px-3.5 text-xs font-semibold text-white no-underline hover:bg-[var(--ss-primary-hover)]"
            >
              <span>Open Studio</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="ss-hero-surface relative border-b border-[var(--ss-border)] overflow-hidden">
        <div className="mx-auto max-w-[1280px] px-6 py-16 lg:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-5 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ss-amber)]/65 bg-[var(--ss-warn-wash)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ss-warn)]">
                <span className="h-2 w-2 rounded-full bg-[var(--ss-amber)]" />
                <span>Data Quality, Drift & CI/CD Studio</span>
              </div>

              <h1 className="text-4xl sm:text-[46px] font-semibold tracking-[-0.038em] leading-[1.06] text-[var(--ss-text)]">
                Inspect every cell.
                <br />
                <span className="text-[var(--ss-primary)]">Prove every fix.</span>
              </h1>

              <p className="text-[15px] leading-relaxed text-[var(--ss-muted)]">
                SyntheSift combines a deterministic DuckDB/Polars profiling engine, automated PII masking, YAML Data Contracts, ML drift detection, and evidence-grounded AI review so data teams ship trustworthy datasets without raw data leakage.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/register"
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--ss-primary)] px-5 text-xs font-semibold text-white no-underline hover:bg-[var(--ss-primary-hover)] shadow-xs"
                >
                  <span>Create workspace</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/workbench"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-5 text-xs font-semibold text-[var(--ss-text)] no-underline hover:bg-[var(--ss-surface-hover)]"
                >
                  <span>Launch Data Studio</span>
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 font-mono text-[10px]">
                <span className="rounded border border-[var(--ss-border-strong)] bg-[var(--ss-surface)] px-2 py-0.5 text-[var(--ss-muted)]">
                  CSV · TSV · Parquet · XLSX · JSON
                </span>
                <span className="rounded bg-[var(--ss-pass-wash)] px-2 py-0.5 font-semibold text-[var(--ss-pass)]">
                  Zero-Row LLM Egress
                </span>
                <span className="rounded bg-[var(--ss-warn-wash)] px-2 py-0.5 font-semibold text-[var(--ss-warn)]">
                  CI/CD Quality Gates
                </span>
              </div>
            </div>

            <div className="lg:col-span-7">
              <InteractivePreview />
            </div>
          </div>
        </div>
      </section>

      {/* Architectural Guarantees Grid */}
      <section id="guarantees" className="border-b border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <div className="mx-auto max-w-[1280px] px-6 py-16">
          <div className="max-w-xl mb-10">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              <span className="h-1.5 w-4 rounded-full bg-[var(--ss-amber)]" />
              ENGINEERING PRINCIPLES
            </span>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.028em]">
              Built like an instrument, not a black-box chatbot.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t border-l border-[var(--ss-border)]">
            {GUARANTEES.map(({ index, title, body, Icon, accent }) => (
              <div
                key={index}
                className="border-r border-b border-[var(--ss-border)] p-6 space-y-3 hover:bg-[var(--ss-surface-hover)]/55 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-[var(--ss-subtle)]">
                    {index}
                  </span>
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${accent}`}>
                    <Icon className="h-4 w-4" strokeWidth={1.7} />
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-[var(--ss-text)]">{title}</h3>
                <p className="text-xs leading-relaxed text-[var(--ss-muted)]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* System Architecture Specification Table */}
      <section id="architecture" className="mx-auto max-w-[1280px] px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4 space-y-3">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              <span className="h-1.5 w-4 rounded-full bg-[var(--ss-amber)]" />
              SYSTEM ARCHITECTURE
            </span>
            <h2 className="text-2xl font-semibold tracking-[-0.028em]">
              End-to-end verifiable pipeline.
            </h2>
            <p className="text-xs leading-relaxed text-[var(--ss-muted)]">
              Designed as a clean modular monolith with strict trust boundaries between untrusted user uploads, deterministic analytics engines, CI/CD gates, and external model APIs.
            </p>
            <div className="pt-2 flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2 text-[var(--ss-text)]">
                <FileCheck2 className="h-4 w-4 text-[var(--ss-primary)]" />
                <span>SHA-256 verified immutable file store</span>
              </div>
              <div className="flex items-center gap-2 text-[var(--ss-text)]">
                <Sparkles className="h-4 w-4 text-[var(--ss-amber)]" />
                <span>One-click multi-format demo datasets included</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 overflow-hidden rounded-lg border border-[var(--ss-border-strong)] bg-[var(--ss-surface)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[var(--ss-border)] bg-[var(--ss-surface-subtle)] font-mono text-[10px] uppercase tracking-wider text-[var(--ss-muted)]">
                <tr>
                  <th className="px-4 py-3">Layer</th>
                  <th className="px-4 py-3">Technology</th>
                  <th className="px-4 py-3">Responsibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ss-border)]">
                {ARCHITECTURE_SPECS.map((row) => (
                  <tr key={row.layer} className="hover:bg-[var(--ss-surface-hover)]/50 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-[var(--ss-text)] whitespace-nowrap">
                      {row.layer}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] font-medium text-[var(--ss-primary)] whitespace-nowrap">
                      {row.stack}
                    </td>
                    <td className="px-4 py-3.5 text-[var(--ss-muted)]">{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--ss-border)] bg-[var(--ss-surface)]">
        <div className="mx-auto flex flex-wrap max-w-[1280px] items-center justify-between gap-4 px-6 py-6 font-mono text-[11px] text-[var(--ss-subtle)]">
          <span>SyntheSift v2 · Deterministic Data Quality, Drift & CI/CD Studio</span>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-[var(--ss-primary)] no-underline">
              Sign in
            </Link>
            <Link href="/workbench" className="hover:text-[var(--ss-primary)] no-underline">
              Studio
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

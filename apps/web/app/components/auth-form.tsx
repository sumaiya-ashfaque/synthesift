'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { Brand } from '@/app/components/brand';
import { request, type Account } from '@/lib/client-api';

type Props = { mode: 'login' | 'register' };

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      username: String(fields.get('username') ?? ''),
      password: String(fields.get('password') ?? ''),
    };
    if (mode === 'register') payload.email = String(fields.get('email') ?? '');

    try {
      await request<Account>(`/api/v1/auth/${mode}`, 'POST', payload);
      router.push(mode === 'login' ? '/workspaces' : '/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[var(--ss-canvas)] text-[var(--ss-text)]">
      {/* Left Architectural Spec Column */}
      <aside className="hidden lg:flex lg:col-span-5 flex-col justify-between border-r border-[var(--ss-border)] bg-[var(--ss-surface)] p-10">
        <Brand />

        <div className="space-y-6 max-w-sm">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              TRUST BOUNDARY & ACCESS
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              Workspace-scoped data quality governance.
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ss-muted)]">
              Every dataset, profile, AI report, and remediation run is isolated inside role-authorized workspaces with full SHA-256 provenance.
            </p>
          </div>

          <ul className="space-y-3 border-t border-[var(--ss-border)] pt-6 text-xs text-[var(--ss-muted)]">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--ss-primary)] mt-0.5" />
              <span>HttpOnly session authentication with strict CSRF validation on all mutations.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Lock className="h-4 w-4 shrink-0 text-[var(--ss-primary)] mt-0.5" />
              <span>Automatic PII detection and default cell masking for viewer & editor safety.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ss-primary)] mt-0.5" />
              <span>Multi-format DuckDB/Polars engine ready for CSV, Parquet, Excel, and JSON.</span>
            </li>
          </ul>
        </div>

        <p className="font-mono text-[10px] text-[var(--ss-subtle)]">
          SyntheSift v2 · Evidence first. Every change reviewed.
        </p>
      </aside>

      {/* Right Form Column */}
      <main className="lg:col-span-7 flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-[420px] space-y-6">
          <div className="lg:hidden">
            <Brand />
          </div>

          <section
            aria-labelledby="auth-title"
            className="rounded-lg border border-[var(--ss-border)] bg-[var(--ss-surface)] p-7 sm:p-8"
          >
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ss-primary)]">
              Secure workspace access
            </p>
            <h1
              id="auth-title"
              className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-[var(--ss-text)]"
            >
              {mode === 'login' ? 'Sign in' : 'Create an account'}
            </h1>
            <p className="mt-1 text-xs text-[var(--ss-muted)]">
              Manage datasets within your authorized workspaces.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="username" className="block text-xs font-medium text-[var(--ss-text)]">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  required
                  maxLength={150}
                  autoComplete="username"
                  className="h-10 w-full rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 text-sm text-[var(--ss-text)] focus:border-[var(--ss-primary)]"
                />
              </div>

              {mode === 'register' && (
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-xs font-medium text-[var(--ss-text)]">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className="h-10 w-full rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 text-sm text-[var(--ss-text)] focus:border-[var(--ss-primary)]"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-xs font-medium text-[var(--ss-text)]">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="h-10 w-full rounded-md border border-[var(--ss-border-strong)] bg-[var(--ss-canvas)] px-3 text-sm text-[var(--ss-text)] focus:border-[var(--ss-primary)]"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-[var(--ss-danger)]/35 bg-[var(--ss-danger-wash)] px-3 py-2 text-xs text-[var(--ss-danger)]"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--ss-primary)] px-4 text-xs font-semibold text-white hover:bg-[var(--ss-primary-hover)] disabled:opacity-50"
              >
                <span>
                  {submitting ? 'Processing…' : mode === 'login' ? 'Sign in' : 'Create account'}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </form>

            <p className="mt-5 pt-5 border-t border-[var(--ss-border)] text-xs text-[var(--ss-muted)]">
              {mode === 'login' ? 'New to SyntheSift?' : 'Already have an account?'}{' '}
              <Link
                href={mode === 'login' ? '/register' : '/login'}
                className="font-semibold text-[var(--ss-primary)] hover:underline"
              >
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

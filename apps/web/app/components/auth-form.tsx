'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, Sparkles, User } from 'lucide-react';
import { request, type Account } from '@/lib/client-api';
import { cn } from '@/lib/cn';

type Props = { mode: 'login' | 'register' };

function SignalVisualArt() {
  return (
    <div className="relative rounded-2xl border border-white/15 bg-black/22 p-5 backdrop-blur-md shadow-[0_24px_48px_-18px_rgba(0,0,0,0.45)]">
      {/* Subtle Top Readout */}
      <div className="flex items-center justify-between gap-2 pb-4 border-b border-white/10">
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#FFF2A7]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#FFA500] shadow-[0_0_10px_#FFA500]" />
          <span className="font-medium tracking-wide">revenue_q4.parquet</span>
        </div>
        <span className="rounded-full bg-[#BEDEFF]/20 border border-[#BEDEFF]/35 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#BEDEFF]">
          GATE PASS
        </span>
      </div>

      {/* Bespoke Dual-Wave Distribution Curve SVG */}
      <div className="py-4">
        <svg
          viewBox="0 0 360 124"
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label="Statistical distribution signal preview"
        >
          <defs>
            <linearGradient id="ss-auth-sky-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#BEDEFF" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#BEDEFF" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="ss-auth-amber-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFA500" stopOpacity="0.40" />
              <stop offset="100%" stopColor="#FFF2A7" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal guide hairlines */}
          {[28, 62, 96].map((y) => (
            <line
              key={y}
              x1={0}
              x2={360}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.09)"
              strokeDasharray="3 4"
            />
          ))}

          {/* Baseline Ice Sky Curve (#BEDEFF) */}
          <path
            d="M 0 106 C 48 104, 72 34, 134 26 C 190 18, 224 72, 276 88 C 314 99, 336 102, 360 104 L 360 112 L 0 112 Z"
            fill="url(#ss-auth-sky-fill)"
          />
          <path
            d="M 0 106 C 48 104, 72 34, 134 26 C 190 18, 224 72, 276 88 C 314 99, 336 102, 360 104"
            fill="none"
            stroke="#BEDEFF"
            strokeWidth="2.2"
            strokeLinecap="round"
          />

          {/* Candidate Signal Amber & Cream Curve (#FFA500 / #FFF2A7) */}
          <path
            d="M 0 108 C 60 106, 108 78, 166 42 C 214 14, 252 38, 294 78 C 322 100, 342 105, 360 106 L 360 112 L 0 112 Z"
            fill="url(#ss-auth-amber-fill)"
          />
          <path
            d="M 0 108 C 60 106, 108 78, 166 42 C 214 14, 252 38, 294 78 C 322 100, 342 105, 360 106"
            fill="none"
            stroke="#FFA500"
            strokeWidth="2.4"
            strokeLinecap="round"
          />

          {/* Highlighted Data Nodes */}
          <circle cx="134" cy="26" r="4" fill="#BEDEFF" stroke="#4B0019" strokeWidth="2" />
          <circle cx="204" cy="27" r="4.5" fill="#FFF2A7" stroke="#930031" strokeWidth="2" />
          <line
            x1="204"
            y1="32"
            x2="204"
            y2="112"
            stroke="#FFF2A7"
            strokeOpacity="0.45"
            strokeDasharray="2 3"
          />
        </svg>
      </div>

      {/* Crisp 3-Metric Strip */}
      <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-white/10 font-mono">
        <div className="rounded-xl bg-white/8 px-3 py-2.5">
          <span className="block text-[9px] uppercase tracking-wider text-white/60">Quality</span>
          <strong className="mt-0.5 block text-base font-semibold tabular-nums text-[#FFF2A7]">
            98.4
          </strong>
        </div>
        <div className="rounded-xl bg-white/8 px-3 py-2.5">
          <span className="block text-[9px] uppercase tracking-wider text-white/60">Drift PSI</span>
          <strong className="mt-0.5 block text-base font-semibold tabular-nums text-[#BEDEFF]">
            0.02
          </strong>
        </div>
        <div className="rounded-xl bg-white/8 px-3 py-2.5">
          <span className="block text-[9px] uppercase tracking-wider text-white/60">PII Risk</span>
          <strong className="mt-0.5 block text-base font-semibold tabular-nums text-[#FFA500]">
            Masked
          </strong>
        </div>
      </div>
    </div>
  );
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const payload: Record<string, string> = { username, password };
    if (mode === 'register') payload.email = email;

    try {
      await request<Account>(`/api/v1/auth/${mode}`, 'POST', payload);
      router.push(mode === 'login' ? '/workspaces' : '/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the request.');
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    setUsername('demo');
    setPassword('SyntheSift2026!');
    setError('');
  }

  return (
    <div className="ss-auth-backdrop relative min-h-screen flex flex-col justify-between px-4 py-5 sm:px-8 sm:py-7 text-[var(--ss-text)] overflow-hidden">
      {/* Subtle architectural contour lines across full backdrop */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        className="pointer-events-none fixed inset-0 h-full w-full opacity-[0.22]"
      >
        <path
          d="M -40 720 Q 340 520, 740 660 T 1500 540"
          fill="none"
          stroke="#930031"
          strokeWidth="1"
        />
        <path
          d="M -40 780 Q 380 580, 780 710 T 1500 600"
          fill="none"
          stroke="#FFA500"
          strokeWidth="1"
        />
        <path
          d="M -40 190 Q 420 60, 860 180 T 1500 90"
          fill="none"
          stroke="#134074"
          strokeOpacity="0.4"
          strokeWidth="1"
        />
      </svg>

      {/* Minimal Floating Top Navigation */}
      <header className="relative z-10 mx-auto flex w-full max-w-[1040px] items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-[var(--ss-text)] no-underline group"
          aria-label="SyntheSift home"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg shadow-xs ring-1 ring-black/5">
            <Image src="/synthesift-mark.svg" alt="" width={32} height={32} />
          </span>
          <span className="text-[16px] font-semibold tracking-[-0.03em]">SyntheSift</span>
        </Link>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ss-border-strong)]/80 bg-[var(--ss-surface)]/85 px-3.5 py-1.5 text-xs font-medium text-[var(--ss-muted)] backdrop-blur-sm no-underline hover:text-[var(--ss-primary)] hover:border-[var(--ss-primary-border)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Home</span>
        </Link>
      </header>

      {/* Center Unified Sculpted Shell */}
      <main className="relative z-10 my-auto py-6">
        <div className="mx-auto grid w-full max-w-[980px] grid-cols-1 lg:grid-cols-12 rounded-[28px] border border-[var(--ss-border-strong)]/70 bg-[var(--ss-surface)]/92 p-2.5 sm:p-3 backdrop-blur-md shadow-[0_32px_90px_-28px_rgba(147,0,49,0.22)]">
          {/* Left Inset Venetian Burgundy Showcase */}
          <aside className="ss-burgundy-stage relative hidden lg:flex lg:col-span-6 flex-col justify-between overflow-hidden rounded-[22px] p-8 text-white">
            {/* Decorative Soft Glow Orbs */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-14 -top-14 h-48 w-48 rounded-full bg-[#FFA500]/25 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-[#BEDEFF]/20 blur-3xl"
            />

            <div className="relative z-10 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#FFF2A7] backdrop-blur-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FFA500]" />
                Data Intelligence Studio
              </span>
            </div>

            <div className="relative z-10 my-6">
              <SignalVisualArt />
            </div>

            <div className="relative z-10 space-y-1.5">
              <h2 className="text-[26px] font-semibold leading-[1.12] tracking-[-0.03em] text-white">
                Data you can ship{' '}
                <span className="text-[#FFF2A7]">with certainty.</span>
              </h2>
            </div>
          </aside>

          {/* Right Form Surface */}
          <section
            aria-labelledby="auth-title"
            className="lg:col-span-6 flex flex-col justify-center px-5 py-7 sm:px-10 sm:py-10"
          >
            <div className="mx-auto w-full max-w-[360px]">
              {/* Mode Segmented Switcher */}
              <div className="mb-7 inline-grid grid-cols-2 rounded-xl border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-1 w-full">
                <Link
                  href="/login"
                  className={cn(
                    'rounded-lg py-2 text-center text-xs font-semibold no-underline transition-all',
                    mode === 'login'
                      ? 'bg-[var(--ss-surface)] text-[var(--ss-primary)] shadow-xs'
                      : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                  )}
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className={cn(
                    'rounded-lg py-2 text-center text-xs font-semibold no-underline transition-all',
                    mode === 'register'
                      ? 'bg-[var(--ss-surface)] text-[var(--ss-primary)] shadow-xs'
                      : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
                  )}
                >
                  Create account
                </Link>
              </div>

              <h1
                id="auth-title"
                className="text-[26px] font-semibold tracking-[-0.03em] text-[var(--ss-text)]"
              >
                {mode === 'login' ? 'Welcome back' : 'Get started'}
              </h1>

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="username" className="block text-xs font-medium text-[var(--ss-muted)]">
                    Username
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ss-subtle)]" />
                    <input
                      id="username"
                      name="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      maxLength={150}
                      autoComplete="username"
                      placeholder="Enter username"
                      className="h-11 w-full rounded-xl border border-[var(--ss-border-strong)]/80 bg-[var(--ss-canvas)]/70 pl-10 pr-3.5 text-sm text-[var(--ss-text)] placeholder:text-[var(--ss-subtle)] transition-colors focus:border-[var(--ss-amber)] focus:bg-[var(--ss-surface)]"
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-xs font-medium text-[var(--ss-muted)]">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ss-subtle)]" />
                      <input
                        id="email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        placeholder="you@company.com"
                        className="h-11 w-full rounded-xl border border-[var(--ss-border-strong)]/80 bg-[var(--ss-canvas)]/70 pl-10 pr-3.5 text-sm text-[var(--ss-text)] placeholder:text-[var(--ss-subtle)] transition-colors focus:border-[var(--ss-amber)] focus:bg-[var(--ss-surface)]"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-xs font-medium text-[var(--ss-muted)]">
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={fillDemo}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--ss-warn-wash)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ss-warn)] hover:opacity-85 transition-opacity"
                      >
                        <Sparkles className="h-2.5 w-2.5 text-[var(--ss-amber)]" />
                        Demo credentials
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ss-subtle)]" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder="••••••••••••"
                      className="h-11 w-full rounded-xl border border-[var(--ss-border-strong)]/80 bg-[var(--ss-canvas)]/70 pl-10 pr-10 text-sm text-[var(--ss-text)] placeholder:text-[var(--ss-subtle)] transition-colors focus:border-[var(--ss-amber)] focus:bg-[var(--ss-surface)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--ss-subtle)] hover:text-[var(--ss-text)]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-[var(--ss-danger)]/30 bg-[var(--ss-danger-wash)] px-3.5 py-2.5 text-xs font-medium text-[var(--ss-danger)]"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="group mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#930031] to-[#B60A43] px-5 text-sm font-semibold text-white shadow-[0_12px_28px_-10px_rgba(147,0,49,0.6)] hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
                >
                  <span>
                    {submitting
                      ? 'Please wait…'
                      : mode === 'login'
                        ? 'Sign in'
                        : 'Create account'}
                  </span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>

      <div className="h-4" aria-hidden="true" />
    </div>
  );
}

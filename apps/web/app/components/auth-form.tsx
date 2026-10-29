'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
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
    <main className="auth-shell">
      <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">S</span>SyntheSift</Link>
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">Secure workspace access</p>
        <h1 id="auth-title">{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
        <p className="muted">Manage datasets within your authorized workspaces.</p>
        <form onSubmit={submit} className="stacked-form">
          <label htmlFor="username">Username</label>
          <input id="username" name="username" required maxLength={150} autoComplete="username" />
          {mode === 'register' && (
            <>
              <label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" required autoComplete="email" />
            </>
          )}
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {error && <p role="alert" className="error-text">{error}</p>}
          <button className="primary-link" type="submit" disabled={submitting}>
            {submitting ? 'Processing…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="muted">
          {mode === 'login' ? 'New to SyntheSift?' : 'Already have an account?'}{' '}
          <Link className="inline-link" href={mode === 'login' ? '/register' : '/login'}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
      </section>
    </main>
  );
}

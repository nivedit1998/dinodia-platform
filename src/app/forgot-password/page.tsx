'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!identifier.trim()) {
      setError('Enter your username or email.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });

      const data = await res.json().catch(() => ({}));
      setLoading(false);

      if (!res.ok) {
        setError(
          data?.error ||
            'Unable to start password reset right now. Please try again.'
        );
        return;
      }

      setInfo(
        'If an account exists for that username or email, we sent a reset link.'
      );
    } catch (err) {
      console.error(err);
      setLoading(false);
      setError('Unable to start password reset right now. Please try again.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 bg-slate-50">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/brand/logo-lockup.png"
            alt="Dinodia Smart Living"
            width={220}
            height={64}
            className="h-auto w-48 sm:w-56"
            priority
          />
        </div>
        <h1 className="text-2xl font-semibold mb-2 text-center">
          Reset your password
        </h1>
        <p className="text-sm text-slate-500 mb-6 text-center">
          Enter your username or email. If we find a match, we&apos;ll email a reset link.
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Username or email
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            className="text-xs text-indigo-600 hover:underline"
            onClick={() => router.push('/login')}
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}

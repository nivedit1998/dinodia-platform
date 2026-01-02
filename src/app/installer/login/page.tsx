'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type LoginResponse =
  | { ok: true; role: string; requiresEmailVerification?: false }
  | { ok: true; role: string; requiresEmailVerification: true; challengeId?: string }
  | { ok?: false; error?: string; requiresEmailVerification?: boolean; challengeId?: string };

export default function InstallerLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [deviceLabel] = useState(() => getDeviceLabel());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!deviceId) {
      setError('Preparing device info. Please try again in a moment.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, deviceId, deviceLabel }),
    });
    const data: LoginResponse = await res.json();
    setLoading(false);

    if (!res.ok || !data.ok) {
      const errMsg = (data as { error?: string }).error;
      setError(errMsg || 'Login failed. Check your details and try again.');
      return;
    }

    if (data.requiresEmailVerification && data.challengeId) {
      router.push(`/installer/verify?challengeId=${encodeURIComponent(data.challengeId)}`);
      return;
    }

    if (data.role === 'INSTALLER') {
      router.push('/installer/provision');
      return;
    }

    setError('This account is not an installer.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Installer login</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your installer account to provision a Dinodia Hub.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700">Username</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

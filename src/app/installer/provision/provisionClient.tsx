'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ProvisionResponse = { ok: true; serial: string; bootstrapSecret: string } | { ok?: false; error?: string };

export default function ProvisionClient({ installerName }: { installerName: string }) {
  const router = useRouter();
  const [serial, setSerial] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [deviceLabel] = useState(() => getDeviceLabel());

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBootstrapSecret(null);
    if (!serial.trim()) {
      setError('Enter a serial.');
      return;
    }
    if (!deviceId) {
      setError('Preparing device info. Try again in a moment.');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/installer/hubs/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        'x-device-label': deviceLabel,
      },
      body: JSON.stringify({ serial: serial.trim() }),
    });
    const data: ProvisionResponse = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
    setLoading(false);

    if (!res.ok || !data.ok) {
      const errMsg = (data as { error?: string }).error;
      setError(errMsg || 'Provisioning failed. Check the serial or try again.');
      return;
    }

    setBootstrapSecret(data.bootstrapSecret);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/installer/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="text-lg font-semibold text-slate-900">{installerName}</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Logout
          </button>
        </header>

        <div className="rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900">Provision a Dinodia Hub</h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter the Dinodia Serial Number. You&apos;ll get a bootstrap secret to paste into the hub add-on.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleProvision}>
            <div>
              <label className="block text-sm font-medium text-slate-700">Dinodia Serial Number</label>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="e.g. DIN-GB-00001234"
                required
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Provisioning…' : 'Provision hub'}
            </button>
          </form>

          {bootstrapSecret && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Bootstrap secret (copy and store safely):</p>
              <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs text-slate-900">
                {bootstrapSecret}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

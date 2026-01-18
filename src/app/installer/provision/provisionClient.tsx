'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ProvisionResponse = { ok: true; serial: string; bootstrapSecret: string } | { ok?: false; error?: string };

export default function ProvisionClient({ installerName }: { installerName: string }) {
  const router = useRouter();
  const [serial, setSerial] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState<string | null>(null);
  const [haBaseUrl, setHaBaseUrl] = useState('');
  const [haCloudUrl, setHaCloudUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [haUser, setHaUser] = useState('');
  const [haPass, setHaPass] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [deviceLabel] = useState(() => getDeviceLabel());

  function normalizeBaseUrl(value: string) {
    const trimmed = value.trim();
    return trimmed.replace(/\/+$/, '');
  }

  function normalizeCloudUrl(value: string) {
    const trimmed = value.trim();
    return trimmed.replace(/\/+$/, '');
  }

  function buildPayload(secret: string) {
    const query = new URLSearchParams({
      v: '3',
      s: serial.trim(),
      bs: secret.trim(),
    });
    return `dinodia://hub?${query.toString()}`;
  }

  async function generateQr(secret: string) {
    setQrError(null);
    setQrDataUrl(null);
    setQrPayload(null);

    const payload = buildPayload(secret);
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
      });
      setQrPayload(payload);
      setQrDataUrl(dataUrl);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Unable to generate QR code.');
    }
  }

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBootstrapSecret(null);
    setQrDataUrl(null);
    setQrPayload(null);
    setQrError(null);
    if (!serial.trim()) {
      setError('Enter a serial.');
      return;
    }
    if (!deviceId) {
      setError('Preparing device info. Try again in a moment.');
      return;
    }
    if (!haBaseUrl.trim() || !haCloudUrl.trim() || !haToken.trim() || !haUser.trim() || !haPass.trim()) {
      setError('Enter HA admin credentials, base URL, cloud URL, and long-lived token.');
      return;
    }
    if (!/^https?:\/\//i.test(haBaseUrl.trim())) {
      setError('Base URL must start with http:// or https://');
      return;
    }
    try {
      const parsed = new URL(haCloudUrl.trim());
      if (parsed.protocol !== 'https:') {
        throw new Error('Cloud URL must start with https://');
      }
      if (!parsed.hostname.toLowerCase().endsWith('.dinodiasmartliving.com')) {
        throw new Error('Cloud URL must end with .dinodiasmartliving.com');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter a valid cloud URL (https://xxx.dinodiasmartliving.com).');
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
      body: JSON.stringify({
        serial: serial.trim(),
        haBaseUrl: normalizeBaseUrl(haBaseUrl),
        haCloudUrl: normalizeCloudUrl(haCloudUrl),
        haLongLivedToken: haToken.trim(),
        haUsername: haUser.trim(),
        haPassword: haPass,
      }),
    });
    const data: ProvisionResponse = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
    setLoading(false);

    if (!res.ok || !data.ok) {
      const errMsg = (data as { error?: string }).error;
      setError(errMsg || 'Provisioning failed. Check the serial or try again.');
      return;
    }

    setBootstrapSecret(data.bootstrapSecret);
    await generateQr(data.bootstrapSecret);
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
            Enter the Dinodia Serial Number. You&apos;ll get a bootstrap secret to paste into the hub add-on and a QR to share with the homeowner.
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Username</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haUser}
                  onChange={(e) => setHaUser(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haPass}
                  onChange={(e) => setHaPass(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
              <label className="block text-sm font-medium text-slate-700">Base URL</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={haBaseUrl}
                onChange={(e) => setHaBaseUrl(e.target.value)}
                placeholder="http://homeassistant.local:8123"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Cloud URL (Dinodia Cloudflare)</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={haCloudUrl}
                onChange={(e) => setHaCloudUrl(e.target.value)}
                placeholder="https://xxx.dinodiasmartliving.com"
                autoComplete="off"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Must start with https:// and end with .dinodiasmartliving.com
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Long-lived access token</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
            {qrError && <p className="text-sm text-rose-600">{qrError}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Provisioning…' : 'Provision hub'}
            </button>

            {bootstrapSecret && (
              <button
                type="button"
                onClick={() => generateQr(bootstrapSecret)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Generate / update QR
              </button>
            )}
          </form>

          {bootstrapSecret && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Bootstrap secret (copy and store safely):</p>
              <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs text-slate-900">
                {bootstrapSecret}
              </code>
            </div>
          )}

          {qrPayload && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold text-slate-800">Share with homeowner</h2>
              <p className="text-xs text-slate-600 mt-1">QR includes only the Dinodia serial and bootstrap secret (no HA credentials).</p>
              {qrDataUrl && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="Dinodia hub QR"
                    className="w-40 h-40 rounded-lg border border-slate-200 bg-white"
                  />
                  <a
                    href={qrDataUrl}
                    download="dinodia-hub-qr.png"
                    className="text-indigo-600 hover:underline text-xs font-medium"
                  >
                    Download QR
                  </a>
                </div>
              )}
              <div className="mt-3 rounded-md bg-white border border-slate-200 p-3 text-[11px] text-slate-700 break-all">
                {qrPayload}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

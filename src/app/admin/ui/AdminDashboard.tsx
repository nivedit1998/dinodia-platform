'use client';

import { useEffect, useState } from 'react';

type Device = {
  entityId: string;
  name: string;
  state: string;
  area: string | null;
  label: string | null;
};

type Props = {
  username: string;
};

type Tab = 'dashboard' | 'settings';

export default function AdminDashboard({ username }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For creating tenant
  const [tenantForm, setTenantForm] = useState({
    username: '',
    password: '',
    area: '',
    label: '',
  });
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);

  async function loadDevices() {
    setLoadingDevices(true);
    setError(null);
    const res = await fetch('/api/devices');
    const data = await res.json();
    setLoadingDevices(false);

    if (!res.ok) {
      setError(data.error || 'Failed to load devices');
      return;
    }
    setDevices(data.devices || []);
  }

  // Poll every 3 seconds to keep dashboard live-ish
  useEffect(() => {
    loadDevices();
    const id = setInterval(loadDevices, 3000);
    return () => clearInterval(id);
  }, []);

  async function logout() {
    await fetch('/api/auth/login', { method: 'DELETE' });
    window.location.href = '/login';
  }

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setTenantMsg(null);
    const res = await fetch('/api/admin/tenant', {
      method: 'POST',
      body: JSON.stringify(tenantForm),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) {
      setTenantMsg(data.error || 'Failed to create tenant');
    } else {
      setTenantMsg('Tenant created successfully ✅');
      setTenantForm({ username: '', password: '', area: '', label: '' });
    }
  }

  return (
    <div className="w-full max-w-5xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Dinodia Admin</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
        </div>
        <button
          onClick={logout}
          className="text-xs px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50"
        >
          Logout
        </button>
      </header>

      <nav className="flex gap-2 text-sm">
        <button
          onClick={() => setTab('dashboard')}
          className={`px-3 py-1.5 rounded-lg border ${
            tab === 'dashboard'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`px-3 py-1.5 rounded-lg border ${
            tab === 'settings'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Settings
        </button>
      </nav>

      {tab === 'dashboard' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">All devices (from HA)</h2>
            <button
              onClick={loadDevices}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              Scan for devices
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {devices.map((d) => (
              <div
                key={d.entityId}
                className="border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-1"
              >
                <div className="font-medium">{d.name}</div>
                <div className="text-slate-500 break-all">{d.entityId}</div>
                <div className="flex justify-between mt-1">
                  <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 px-2 py-0.5 rounded-full">
                    Area: <span className="font-medium">{d.area || '-'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 px-2 py-0.5 rounded-full">
                    Label: <span className="font-medium">{d.label || '-'}</span>
                  </span>
                </div>
                <div className="mt-2 text-[11px]">
                  State: <span className="font-semibold">{d.state}</span>
                </div>
                {/* Placeholder for future "change area/label" actions */}
              </div>
            ))}
            {devices.length === 0 && !loadingDevices && (
              <p className="text-xs text-slate-500">
                No devices found yet. Make sure HA URL and token are correct.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          {/* Profile stub – update later */}
          <div>
            <h2 className="font-semibold mb-3">Profile (coming next)</h2>
            <p className="text-xs text-slate-500">
              Here you&apos;ll be able to change your portal password and Home
              Assistant details.
            </p>
          </div>

          {/* Home Setup – create tenants */}
          <div>
            <h2 className="font-semibold mb-3">Home setup – add tenant</h2>
            <form onSubmit={createTenant} className="space-y-3">
              <div>
                <label className="block mb-1">Tenant Username</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tenantForm.username}
                  onChange={(e) =>
                    setTenantForm((f) => ({ ...f, username: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block mb-1">Tenant Password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tenantForm.password}
                  onChange={(e) =>
                    setTenantForm((f) => ({ ...f, password: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">Associated Area</label>
                  <input
                    placeholder="Room 1, Kitchen..."
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={tenantForm.area}
                    onChange={(e) =>
                      setTenantForm((f) => ({ ...f, area: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="block mb-1">Associated Label</label>
                  <input
                    placeholder="Light, Blind, TV..."
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={tenantForm.label}
                    onChange={(e) =>
                      setTenantForm((f) => ({ ...f, label: e.target.value }))
                    }
                  />
                </div>
              </div>
              <button
                type="submit"
                className="mt-1 bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700"
              >
                Add Tenant
              </button>
            </form>
            {tenantMsg && (
              <p className="mt-2 text-xs text-slate-600">{tenantMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

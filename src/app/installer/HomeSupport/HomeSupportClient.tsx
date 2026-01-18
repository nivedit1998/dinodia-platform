'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type HomeSummary = {
  homeId: number;
  installedAt: string;
};

type HomeDetail = {
  homeId: number;
  installedAt: string;
  credentials: {
    haUsername: string;
    haPassword: string;
    baseUrl: string;
    cloudUrl: string | null;
    longLivedToken: string;
  };
  hubStatus: {
    serial: string | null;
    lastSeenAt: string | null;
    installedAt: string;
    platformSyncEnabled?: boolean;
    rotateEveryMinutes?: number | null;
    graceMinutes?: number | null;
    publishedHubTokenVersion?: number | null;
    lastAckedHubTokenVersion?: number | null;
  } | null;
  homeowners: { email: string | null; username: string }[];
  tenants: { email: string | null; username: string; areas: string[] }[];
  alexaEnabled: { email: string | null; username: string }[];
};

type DevicesByUser = {
  userId: number;
  username: string;
  email: string | null;
  role: string;
  devices: UIDevice[];
};

type UIDevice = {
  entityId: string;
  deviceId: string;
  name: string;
  state: string;
  area: string | null;
  areaName: string | null;
  labels?: (string | null)[];
  label?: string | null;
  labelCategory?: string | null;
  domain?: string | null;
};

type DevicesResponse = { ok: true; devicesByUser: DevicesByUser[] };

export default function HomeSupportClient({ installerName }: { installerName: string }) {
  const [homes, setHomes] = useState<HomeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedHomeId, setExpandedHomeId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, HomeDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<number, boolean>>({});
  const [detailError, setDetailError] = useState<Record<number, string | null>>({});

  const [devices, setDevices] = useState<Record<number, DevicesResponse>>({});
  const [devicesLoading, setDevicesLoading] = useState<Record<number, boolean>>({});
  const [devicesError, setDevicesError] = useState<Record<number, string | null>>({});

  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const deviceLabel = useMemo(() => getDeviceLabel(), []);

  useEffect(() => {
    let cancelled = false;
    async function loadHomes() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/installer/home-support/homes', {
          headers: {
            'x-device-id': deviceId ?? '',
            'x-device-label': deviceLabel ?? '',
          },
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Failed to load homes.');
        }
        if (!cancelled) setHomes(data.homes ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load homes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadHomes();
    return () => {
      cancelled = true;
    };
  }, [deviceId, deviceLabel]);

  async function loadDetail(homeId: number) {
    setDetailError((prev) => ({ ...prev, [homeId]: null }));
    setDetailLoading((prev) => ({ ...prev, [homeId]: true }));
    try {
      const res = await fetch(`/api/installer/home-support/homes/${homeId}`, {
        headers: {
          'x-device-id': deviceId ?? '',
          'x-device-label': deviceLabel ?? '',
        },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load home details.');
      }
      setDetails((prev) => ({ ...prev, [homeId]: data }));
    } catch (err) {
      setDetailError((prev) => ({
        ...prev,
        [homeId]: err instanceof Error ? err.message : 'Failed to load home details.',
      }));
    } finally {
      setDetailLoading((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  async function loadDevices(homeId: number) {
    setDevicesError((prev) => ({ ...prev, [homeId]: null }));
    setDevicesLoading((prev) => ({ ...prev, [homeId]: true }));
    try {
      const res = await fetch(`/api/installer/home-support/homes/${homeId}/devices`, {
        headers: {
          'x-device-id': deviceId ?? '',
          'x-device-label': deviceLabel ?? '',
        },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load devices.');
      }
      setDevices((prev) => ({ ...prev, [homeId]: data }));
    } catch (err) {
      setDevicesError((prev) => ({
        ...prev,
        [homeId]: err instanceof Error ? err.message : 'Failed to load devices.',
      }));
    } finally {
      setDevicesLoading((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  function toggleHome(homeId: number) {
    const next = expandedHomeId === homeId ? null : homeId;
    setExpandedHomeId(next);
    if (next && !details[next]) {
      void loadDetail(next);
    }
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  function CredentialRow({ label, value }: { label: string; value: string | null }) {
    return (
      <div className="flex flex-col">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="font-mono text-sm text-slate-900 break-all">{value ?? '—'}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Installer</p>
            <p className="text-lg font-semibold text-slate-900">{installerName}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/installer/provision"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Provision hubs
            </Link>
            <Link
              href="/installer/login"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </Link>
          </div>
        </header>

        <div className="rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Home Support</h1>
              <p className="text-sm text-slate-600">View installed homes and troubleshoot access.</p>
            </div>
          </div>

          {loading && <p className="mt-4 text-sm text-slate-600">Loading homes…</p>}
          {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

          <div className="mt-6 space-y-4">
            {homes.map((home) => {
              const isOpen = expandedHomeId === home.homeId;
              const detail = details[home.homeId];
              const dLoading = detailLoading[home.homeId];
              const dError = detailError[home.homeId];
              const devData = devices[home.homeId];
              const devLoading = devicesLoading[home.homeId];
              const devError = devicesError[home.homeId];
              return (
                <div
                  key={home.homeId}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Home #{home.homeId}</p>
                      <p className="text-xs text-slate-600">
                        Installed {formatDate(home.installedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleHome(home.homeId)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {isOpen ? 'Hide details' : 'View details'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-4 space-y-4">
                      {dLoading && <p className="text-sm text-slate-600">Loading details…</p>}
                      {dError && <p className="text-sm text-rose-600">{dError}</p>}

                      {detail && (
                        <div className="space-y-4">
                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">
                              Home Credentials (Sensitive)
                            </p>
                            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <CredentialRow label="HA Username" value={detail.credentials.haUsername} />
                              <CredentialRow label="HA Password" value={detail.credentials.haPassword} />
                              <CredentialRow label="Base URL" value={detail.credentials.baseUrl} />
                              <CredentialRow label="Cloud URL" value={detail.credentials.cloudUrl} />
                              <CredentialRow label="Long-lived token" value={detail.credentials.longLivedToken} />
                            </div>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Hub Local connection Status</p>
                            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <CredentialRow label="Serial" value={detail.hubStatus?.serial ?? null} />
                              <CredentialRow
                                label="Last seen"
                                value={formatDate(detail.hubStatus?.lastSeenAt)}
                              />
                              <CredentialRow
                                label="Token version (published/acked)"
                                value={
                                  detail.hubStatus?.publishedHubTokenVersion != null
                                    ? `${detail.hubStatus.publishedHubTokenVersion} / ${detail.hubStatus?.lastAckedHubTokenVersion ?? '—'}`
                                    : '—'
                                }
                              />
                            </div>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Current Homeowner</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {detail.homeowners.length === 0 && <li>None</li>}
                              {detail.homeowners.map((u) => (
                                <li key={u.username}>
                                  {u.email ?? 'No email'} ({u.username})
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Tenants</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {detail.tenants.length === 0 && <li>None</li>}
                              {detail.tenants.map((u) => (
                                <li key={u.username}>
                                  {u.email ?? 'No email'} ({u.username})
                                  {u.areas.length > 0 && (
                                    <span className="text-xs text-slate-600"> — Areas: {u.areas.join(', ')}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Alexa Enabled</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {detail.alexaEnabled.length === 0 && <li>None</li>}
                              {detail.alexaEnabled.map((u) => (
                                <li key={u.username}>{u.email ?? 'No email'} ({u.username})</li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-slate-900">Devices (per user)</p>
                              <button
                                onClick={() => loadDevices(home.homeId)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                disabled={devLoading}
                              >
                                {devLoading ? 'Loading…' : devData ? 'Refresh devices' : 'Load devices'}
                              </button>
                            </div>
                            {devError && <p className="mt-2 text-sm text-rose-600">{devError}</p>}
                            {devData && (
                              <div className="mt-3 space-y-3">
                                {devData.devicesByUser.map((u) => (
                                  <div key={u.userId} className="rounded border border-slate-200 p-2">
                                    <p className="text-sm font-semibold text-slate-800">
                                      {u.email ?? u.username} — {u.role}
                                    </p>
                                    {u.devices.length === 0 ? (
                                      <p className="text-xs text-slate-600">No devices in scope.</p>
                                    ) : (
                                      <ul className="mt-1 space-y-1 text-xs text-slate-700">
                                        {u.devices.map((d) => (
                                          <li key={`${u.userId}-${d.entityId}`} className="flex flex-wrap gap-1">
                                            <span className="font-mono">{d.entityId}</span>
                                            <span className="text-slate-500">•</span>
                                            <span>{d.name}</span>
                                            {d.areaName && (
                                              <>
                                                <span className="text-slate-500">•</span>
                                                <span>Area: {d.areaName}</span>
                                              </>
                                            )}
                                            {d.labelCategory && (
                                              <>
                                                <span className="text-slate-500">•</span>
                                                <span>Label: {d.labelCategory}</span>
                                              </>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && homes.length === 0 && (
              <p className="text-sm text-slate-600">No homes found for this installer.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

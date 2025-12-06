'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UIDevice } from '@/types/device';
import {
  getGroupLabel,
  sortLabels,
  normalizeLabel,
  getPrimaryLabel,
} from '@/lib/deviceLabels';
import { DeviceTile } from '@/components/device/DeviceTile';
import { DeviceDetailSheet } from '@/components/device/DeviceDetailSheet';
import { DeviceEditSheet } from '@/components/device/DeviceEditSheet';
import { subscribeToRefresh } from '@/lib/refreshBus';

type Props = {
  username: string;
};

type EditValues = Record<
  string,
  {
    name: string;
    area: string;
    label: string;
  }
>;

type ViewMode = 'home' | 'holiday';

function devicesAreDifferent(a: UIDevice[], b: UIDevice[]) {
  if (a.length !== b.length) return true;
  const mapA = new Map(a.map((d) => [d.entityId, d]));
  for (const d of b) {
    const prev = mapA.get(d.entityId);
    if (!prev) return true;
    if (
      prev.state !== d.state ||
      prev.name !== d.name ||
      (prev.area ?? prev.areaName) !== (d.area ?? d.areaName) ||
      prev.label !== d.label ||
      prev.labelCategory !== d.labelCategory
    ) {
      return true;
    }
  }
  return false;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  }).format(date);
}

export default function AdminDashboard(props: Props) {
  void props;
  const [devicesByMode, setDevicesByMode] = useState<Record<ViewMode, UIDevice[]>>({
    home: [],
    holiday: [],
  });
  const [errorsByMode, setErrorsByMode] = useState<Record<ViewMode, string | null>>({
    home: null,
    holiday: null,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const editingDeviceIdRef = useRef<string | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const viewModeRef = useRef<ViewMode>('home');
  const [supportsHoliday, setSupportsHoliday] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const requestCounterRef = useRef(0);
  const latestRequestRef = useRef<Record<ViewMode, number>>({
    home: 0,
    holiday: 0,
  });
  const [loadingByMode, setLoadingByMode] = useState<Record<ViewMode, boolean>>({
    home: false,
    holiday: false,
  });
  const lastLoadedRef = useRef<Record<ViewMode, number | null>>({
    home: null,
    holiday: null,
  });
  const abortControllersRef = useRef<Record<ViewMode, AbortController | null>>({
    home: null,
    holiday: null,
  });

  const loadDevices = useCallback(
    async (opts?: { silent?: boolean; modeOverride?: ViewMode; force?: boolean }) => {
      const silent = opts?.silent ?? false;
      const force = opts?.force ?? false;
      const mode = opts?.modeOverride ?? viewModeRef.current;
      const now = Date.now();
      const lastLoaded = lastLoadedRef.current[mode];
      if (!force && lastLoaded && now - lastLoaded < 60_000) {
        setLoadingByMode((prev) => ({ ...prev, [mode]: false }));
        return;
      }

      const requestId = requestCounterRef.current + 1;
      requestCounterRef.current = requestId;
      latestRequestRef.current[mode] = requestId;

      if (!silent) {
        setErrorsByMode((prev) => ({ ...prev, [mode]: null }));
        setMessage(null);
      }
      setLoadingByMode((prev) => ({ ...prev, [mode]: true }));

      if (abortControllersRef.current[mode]) {
        abortControllersRef.current[mode]?.abort();
      }
      const controller = new AbortController();
      abortControllersRef.current[mode] = controller;

      try {
        const url = mode === 'holiday' ? '/api/devices?view=holiday' : '/api/devices';
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        const isLatest = latestRequestRef.current[mode] === requestId;
        if (!isLatest) return;

        setLoadingByMode((prev) => ({ ...prev, [mode]: false }));
        abortControllersRef.current[mode] = null;

        if (!res.ok) {
          setErrorsByMode((prev) => ({ ...prev, [mode]: data.error || 'Failed to load devices' }));
          return;
        }

        const list: UIDevice[] = data.devices || [];
        let shouldUpdateEdits = false;
        setDevicesByMode((prev) => {
          const previous = prev[mode] ?? [];
          if (!devicesAreDifferent(previous, list)) return prev;
          shouldUpdateEdits = true;
          return { ...prev, [mode]: list };
        });
        if (shouldUpdateEdits) {
          setEditValues((prev) => {
            const next = { ...prev };
            for (const d of list) {
              if (editingDeviceIdRef.current === d.entityId) continue;
              next[d.entityId] = {
                name: d.name,
                area: d.area ?? d.areaName ?? '',
                label: d.label || getPrimaryLabel(d),
              };
            }
            return next;
          });
        }
        lastLoadedRef.current[mode] = Date.now();
      } catch (err) {
        const isLatest = latestRequestRef.current[mode] === requestId;
        if (!isLatest) return;
        if ((err as Error).name === 'AbortError') {
          setLoadingByMode((prev) => ({ ...prev, [mode]: false }));
          abortControllersRef.current[mode] = null;
          return;
        }
        console.error(err);
        setLoadingByMode((prev) => ({ ...prev, [mode]: false }));
        abortControllersRef.current[mode] = null;
        setErrorsByMode((prev) => ({ ...prev, [mode]: 'Failed to load devices' }));
      }
    },
    []
  );

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    editingDeviceIdRef.current = editingDeviceId;
  }, [editingDeviceId]);

  useEffect(() => {
    let mounted = true;
    async function loadConfig() {
      try {
        const res = await fetch('/api/tenant/dashboard-config');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        const supports = Boolean(data.supportsHoliday);
        setSupportsHoliday(supports);

        let initialMode: ViewMode = 'home';
        if (typeof window !== 'undefined') {
          const stored = window.localStorage.getItem('dinodia_view_mode');
          if (stored === 'holiday' && supports) {
            initialMode = 'holiday';
          }
        }
        setViewMode(initialMode);
      } finally {
        if (mounted) setConfigLoading(false);
      }
    }
    void loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (configLoading) return;
    void loadDevices();
  }, [loadDevices, configLoading]);

  useEffect(() => {
    const unsubscribe = subscribeToRefresh(() => {
      void loadDevices({ silent: true });
    });
    return unsubscribe;
  }, [loadDevices]);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      abortControllersRef.current.home?.abort();
      abortControllersRef.current.holiday?.abort();
    },
    []
  );

  const handleModeChange = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode || configLoading) return;
      if (mode === 'holiday' && !supportsHoliday) return;
      setViewMode(mode);
      setOpenDeviceId(null);
      setErrorsByMode((prev) => ({ ...prev, [mode]: null }));
      setMessage(null);
      setLoadingByMode((prev) => ({ ...prev, [mode]: true }));
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('dinodia_view_mode', mode);
      }
      void loadDevices({ silent: false, modeOverride: mode });
    },
    [viewMode, configLoading, supportsHoliday, loadDevices]
  );

  const devices = useMemo(
    () => devicesByMode[viewMode] || [],
    [devicesByMode, viewMode]
  );
  const isLoading = loadingByMode[viewMode];
  const currentError = errorsByMode[viewMode];
  const hasDevices = devices.length > 0;
  const holidayDisabled = !supportsHoliday || configLoading;

  const visibleDevices = useMemo(
    () =>
      devices.filter((d) => {
        const areaName = (d.area ?? d.areaName ?? '').trim();
        const labels = Array.isArray(d.labels) ? d.labels : [];
        const hasLabel =
          normalizeLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeLabel(lbl).length > 0);
        return areaName.length > 0 && hasLabel;
      }),
    [devices]
  );

  const labelGroups = useMemo(() => {
    const map = new Map<string, UIDevice[]>();
    visibleDevices.forEach((device) => {
      const key = getGroupLabel(device);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(device);
    });
    return map;
  }, [visibleDevices]);

  const sortedLabels = useMemo(
    () => sortLabels(Array.from(labelGroups.keys())),
    [labelGroups]
  );

  async function saveDevice(entityId: string) {
    const current = editValues[entityId];
    if (!current) return;

    setSavingDeviceId(entityId);
    setMessage(null);

    const res = await fetch('/api/admin/device', {
      method: 'POST',
      body: JSON.stringify({
        entityId,
        name: current.name,
        area: current.area,
        label: current.label,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to save device');
    } else {
      setMessage('Device settings saved');
      setEditingDeviceId(null);
      void loadDevices({ silent: true, force: true });
    }
    setSavingDeviceId(null);
  }

  const openDevice = openDeviceId
    ? devices.find((d) => d.entityId === openDeviceId) ?? null
    : null;

  const relatedDevices =
    openDevice && getGroupLabel(openDevice) === 'Home Security'
      ? devices.filter((d) => getGroupLabel(d) === 'Home Security')
      : undefined;

  const editingDevice = editingDeviceId
    ? devices.find((d) => d.entityId === editingDeviceId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-10 lg:pt-14">
        <header className="sticky top-4 z-30 flex h-14 items-center justify-between rounded-full border border-white/60 bg-white/80 px-6 text-sm text-slate-600 shadow-sm backdrop-blur-xl">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
              Dinodia Admin
            </p>
            <p className="text-lg font-semibold text-slate-900">
              Building controls
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Today
              </p>
              <p>{clock}</p>
            </div>
            {isLoading && (
              <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                Refreshing…
              </span>
            )}
            <div className="flex items-center gap-1 rounded-full bg-slate-100 px-1 py-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => handleModeChange('home')}
                className={`px-2 py-1 rounded-full ${
                  viewMode === 'home'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                At home
              </button>
              <button
                type="button"
                onClick={() => supportsHoliday && handleModeChange('holiday')}
                disabled={holidayDisabled}
                className={`px-2 py-1 rounded-full ${
                  viewMode === 'holiday'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500'
                } ${holidayDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                Holiday
              </button>
            </div>
          </div>
        </header>

        {currentError && !hasDevices && (
          <div className="rounded-3xl border border-red-100 bg-red-50/80 px-6 py-4 text-sm text-red-600 shadow-sm">
            {currentError}
          </div>
        )}
        {currentError && hasDevices && (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span>{currentError}</span>
          </div>
        )}
        {message && (
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50/80 px-6 py-4 text-sm text-emerald-700 shadow-sm">
            {message}
          </div>
        )}

        <div className="space-y-10">
          {sortedLabels.map((label) => {
            const group = labelGroups.get(label);
            if (!group || group.length === 0) return null;
            return (
              <section key={label} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {label}
                  </h2>
                  {isLoading && (
                    <span className="text-xs text-slate-400">
                      Refreshing…
                    </span>
                  )}
                </div>
                <div className="relative">
                  {isLoading && (
                    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/70 via-white/30 to-white/0 backdrop-blur-sm animate-pulse" />
                  )}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {group.map((device) => (
                      <DeviceTile
                        key={device.entityId}
                        device={device}
                        viewMode={viewMode}
                        onOpenDetails={() => setOpenDeviceId(device.entityId)}
                        onActionComplete={() => loadDevices({ silent: true, force: true })}
                        showAdminControls
                        onOpenAdminEdit={() => setEditingDeviceId(device.entityId)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}

          {sortedLabels.length === 0 && !isLoading && (
            <p className="rounded-3xl border border-slate-200/70 bg-white/70 px-6 py-10 text-center text-sm text-slate-500">
              No devices with both area and label were found. Confirm your Home
              Assistant labels and areas.
            </p>
          )}
        </div>
      </div>

      {openDevice && (
        <DeviceDetailSheet
          device={openDevice}
          viewMode={viewMode}
          onClose={() => setOpenDeviceId(null)}
          onActionComplete={() => loadDevices({ silent: true, force: true })}
          relatedDevices={relatedDevices}
          showAdminControls
          onOpenAdminEdit={() => setEditingDeviceId(openDevice.entityId)}
        />
      )}

      {editingDevice && (
        <DeviceEditSheet
          device={editingDevice}
          values={
            editValues[editingDevice.entityId] || {
              name: editingDevice.name,
              area: editingDevice.area ?? editingDevice.areaName ?? '',
              label:
                editingDevice.label || getPrimaryLabel(editingDevice) || '',
            }
          }
          onChange={(key, value) =>
            setEditValues((prev) => ({
              ...prev,
              [editingDevice.entityId]: {
                ...(prev[editingDevice.entityId] || {
                  name: editingDevice.name,
                  area: editingDevice.area ?? editingDevice.areaName ?? '',
                  label:
                    editingDevice.label || getPrimaryLabel(editingDevice) || '',
                }),
                [key]: value,
              },
            }))
          }
          onSave={() => saveDevice(editingDevice.entityId)}
          onClose={() => setEditingDeviceId(null)}
          saving={savingDeviceId === editingDevice.entityId}
        />
      )}
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel } from '@/lib/deviceLabels';
import { getCurrentTemperature, getTargetTemperature } from '@/lib/deviceCapabilities';

const HEAT_LABELS = new Set(['Boiler', 'Radiator']);
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MAX_DELTA_SECONDS = 3 * 60 * 60;
const MAX_ERROR_LENGTH = 300;

type ConnectionSnapshotFailure = {
  haConnectionId: number;
  error: string;
};

function normalizeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err);
  const compact = (raw || 'Unknown error').replace(/\s+/g, ' ').trim();
  return compact.length > MAX_ERROR_LENGTH
    ? `${compact.slice(0, MAX_ERROR_LENGTH)}...`
    : compact;
}

export async function captureBoilerTempSnapshotForConnection(haConnectionId: number, now = new Date()) {
  const devices = await getDevicesForHaConnection(haConnectionId);
  const boilerDevices = devices.filter((d) => HEAT_LABELS.has(getGroupLabel(d)));

  type HeatGroupLabel = 'Boiler' | 'Radiator';
  type SnapshotReading = {
    haConnectionId: number;
    entityId: string;
    groupLabel: HeatGroupLabel;
    numericValue: number;
    currentTemperature: number;
    targetTemperature: number | null;
    unit: string;
    capturedAt: Date;
  };

  const baseReadings = boilerDevices
    .map((d): SnapshotReading | null => {
      const groupLabelRaw = getGroupLabel(d);
      if (groupLabelRaw !== 'Boiler' && groupLabelRaw !== 'Radiator') return null;
      const groupLabel: HeatGroupLabel = groupLabelRaw;
      const attrs = d.attributes ?? {};
      const current = getCurrentTemperature(attrs);
      if (typeof current !== 'number' || !Number.isFinite(current)) return null;
      const state = String(d.state ?? '').trim().toLowerCase();
      const hvacMode = typeof attrs.hvac_mode === 'string' ? attrs.hvac_mode.trim().toLowerCase() : '';
      const isExplicitOff = state === 'off' || hvacMode === 'off';
      const rawTarget = isExplicitOff ? null : getTargetTemperature(attrs);
      const target = isExplicitOff
        ? 0
        : typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget > 0
        ? rawTarget
        : null;
      return {
        haConnectionId,
        entityId: d.entityId,
        groupLabel,
        numericValue: current,
        currentTemperature: current,
        targetTemperature: typeof target === 'number' && Number.isFinite(target) ? target : null,
        unit: '°C',
        capturedAt: now,
      };
    })
    .filter((r): r is SnapshotReading => r !== null);

  if (baseReadings.length === 0) {
    return { haConnectionId, totalDevices: devices.length, boilerCount: 0, insertedCount: 0 };
  }

  const cutoff = new Date(now.getTime() - MIN_INTERVAL_MS);
  const recent = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      entityId: { in: baseReadings.map((r) => r.entityId) },
      capturedAt: { gte: cutoff },
    },
    select: { entityId: true },
  });
  const recentSet = new Set(recent.map((r) => r.entityId));
  const toInsert = baseReadings.filter((r) => !recentSet.has(r.entityId));

  const boilerEntityIds = toInsert.filter((r) => r.groupLabel === 'Boiler').map((r) => r.entityId);
  const radiatorEntityIds = toInsert.filter((r) => r.groupLabel === 'Radiator').map((r) => r.entityId);

  const [boilerAccumulators, radiatorAccumulators] = await Promise.all([
    boilerEntityIds.length
      ? prisma.boilerUsageAccumulator.findMany({
          where: { haConnectionId, entityId: { in: boilerEntityIds } },
          select: {
            entityId: true,
            onSeconds: true,
            offSeconds: true,
            unknownSeconds: true,
            lastSnapshotOnSeconds: true,
            lastSnapshotOffSeconds: true,
            lastSnapshotUnknownSeconds: true,
          },
        })
      : Promise.resolve([]),
    radiatorEntityIds.length
      ? prisma.radiatorUsageAccumulator.findMany({
          where: { haConnectionId, entityId: { in: radiatorEntityIds } },
          select: {
            entityId: true,
            onSeconds: true,
            offSeconds: true,
            unknownSeconds: true,
            lastSnapshotOnSeconds: true,
            lastSnapshotOffSeconds: true,
            lastSnapshotUnknownSeconds: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const boilerAccMap = new Map(boilerAccumulators.map((a) => [a.entityId, a]));
  const radiatorAccMap = new Map(radiatorAccumulators.map((a) => [a.entityId, a]));

  const cursorUpdates: Array<{
    groupLabel: 'Boiler' | 'Radiator';
    entityId: string;
    onSeconds: number;
    offSeconds: number;
    unknownSeconds: number;
    onForSeconds: number | null;
    offForSeconds: number | null;
    unknownForSeconds: number | null;
  }> = [];

  const data = toInsert.map((reading) => {
    const acc = reading.groupLabel === 'Boiler' ? boilerAccMap.get(reading.entityId) : radiatorAccMap.get(reading.entityId);
    if (!acc) {
      return {
        haConnectionId: reading.haConnectionId,
        entityId: reading.entityId,
        numericValue: reading.numericValue,
        currentTemperature: reading.currentTemperature,
        targetTemperature: reading.targetTemperature,
        onForSeconds: null,
        offForSeconds: null,
        unknownForSeconds: null,
        unit: reading.unit,
        capturedAt: reading.capturedAt,
      };
    }

    const onSeconds = Math.max(0, Math.floor(Number(acc.onSeconds ?? 0)));
    const offSeconds = Math.max(0, Math.floor(Number(acc.offSeconds ?? 0)));
    const unknownSeconds = Math.max(0, Math.floor(Number(acc.unknownSeconds ?? 0)));
    const cursorOn = acc.lastSnapshotOnSeconds;
    const cursorOff = acc.lastSnapshotOffSeconds;
    const cursorUnknown = acc.lastSnapshotUnknownSeconds;

    let onForSeconds: number | null = null;
    let offForSeconds: number | null = null;
    let unknownForSeconds: number | null = null;

    if (typeof cursorOn === 'number' && Number.isFinite(cursorOn) && typeof cursorOff === 'number' && Number.isFinite(cursorOff)) {
      const rawOn = onSeconds - cursorOn;
      const rawOff = offSeconds - cursorOff;
      if (rawOn >= 0 && rawOff >= 0) {
        onForSeconds = Math.min(MAX_DELTA_SECONDS, Math.floor(rawOn));
        offForSeconds = Math.min(MAX_DELTA_SECONDS, Math.floor(rawOff));
      }
    }

    if (typeof cursorUnknown === 'number' && Number.isFinite(cursorUnknown)) {
      const rawUnknown = unknownSeconds - cursorUnknown;
      if (rawUnknown >= 0) {
        unknownForSeconds = Math.min(MAX_DELTA_SECONDS, Math.floor(rawUnknown));
      }
    }

    cursorUpdates.push({
      groupLabel: reading.groupLabel,
      entityId: reading.entityId,
      onSeconds,
      offSeconds,
      unknownSeconds,
      onForSeconds,
      offForSeconds,
      unknownForSeconds,
    });

    return {
      haConnectionId: reading.haConnectionId,
      entityId: reading.entityId,
      numericValue: reading.numericValue,
      currentTemperature: reading.currentTemperature,
      targetTemperature: reading.targetTemperature,
      onForSeconds,
      offForSeconds,
      unknownForSeconds,
      unit: reading.unit,
      capturedAt: reading.capturedAt,
    };
  });

  const inserted = data.length
    ? await prisma.$transaction(async (tx) => {
        const created = await tx.boilerTemperatureReading.createMany({ data });

        if (cursorUpdates.length > 0) {
          const boilerUpdates = cursorUpdates.filter((u) => u.groupLabel === 'Boiler');
          const radiatorUpdates = cursorUpdates.filter((u) => u.groupLabel === 'Radiator');

          for (const update of boilerUpdates) {
            await tx.boilerUsageAccumulator.update({
              where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
              data: {
                lastSnapshotOnSeconds: update.onSeconds,
                lastSnapshotOffSeconds: update.offSeconds,
                lastSnapshotUnknownSeconds: update.unknownSeconds,
                lastSnapshotAt: now,
              },
            });
          }

          for (const update of radiatorUpdates) {
            await tx.radiatorUsageAccumulator.update({
              where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
              data: {
                lastSnapshotOnSeconds: update.onSeconds,
                lastSnapshotOffSeconds: update.offSeconds,
                lastSnapshotUnknownSeconds: update.unknownSeconds,
                lastSnapshotAt: now,
              },
            });
          }
        }

        return created;
      })
    : { count: 0 };

  return {
    haConnectionId,
    totalDevices: devices.length,
    boilerCount: baseReadings.length,
    insertedCount: inserted.count,
  };
}

export async function captureBoilerTempSnapshotForAllConnections(now = new Date()) {
  const connections = await prisma.haConnection.findMany({
    select: { id: true },
  });

  let totalDevices = 0;
  let boilerCount = 0;
  let insertedCount = 0;
  const failures: ConnectionSnapshotFailure[] = [];

  for (const { id } of connections) {
    try {
      const summary = await captureBoilerTempSnapshotForConnection(id, now);
      totalDevices += summary.totalDevices;
      boilerCount += summary.boilerCount;
      insertedCount += summary.insertedCount;
    } catch (err) {
      const message = normalizeErrorMessage(err);
      failures.push({ haConnectionId: id, error: message });
      console.error('[boilerMonitoring] snapshot failed for connection', {
        haConnectionId: id,
        error: message,
      });
    }
  }

  return {
    connections: connections.length,
    totalDevices,
    boilerCount,
    insertedCount,
    failedConnections: failures.length,
    failures,
  };
}

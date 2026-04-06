import { prisma } from '@/lib/prisma';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel, OTHER_LABEL } from '@/lib/deviceLabels';

const MONITORING_OBSERVED_LOOKBACK_DAYS = 90;
const MAX_OBSERVED_ENTITIES = 500;

type MonitoringMetadataCandidate = {
  entityId: string;
  name: string;
  area: string | null;
};

async function upsertDeviceMetadataForMonitoringEntities(
  haConnectionId: number,
  candidates: MonitoringMetadataCandidate[]
) {
  if (candidates.length === 0) return;

  const uniqueCandidates = new Map<string, MonitoringMetadataCandidate>();
  for (const c of candidates) {
    const key = c.entityId;
    if (uniqueCandidates.has(key)) continue;
    const name = (c.name || c.entityId).trim();
    const area = (c.area || '').trim();
    uniqueCandidates.set(key, {
      entityId: c.entityId,
      name: name.length > 0 ? name : c.entityId,
      area: area.length > 0 ? area : null,
    });
  }

  const entityIds = Array.from(uniqueCandidates.keys());
  const existing = await prisma.device.findMany({
    where: { haConnectionId, entityId: { in: entityIds } },
    select: { entityId: true, name: true, area: true },
  });
  const existingById = new Map(existing.map((d) => [d.entityId, d]));

  const creates: MonitoringMetadataCandidate[] = [];
  const updates: Array<{ entityId: string; data: { area?: string | null; name?: string } }> = [];

  for (const candidate of uniqueCandidates.values()) {
    const current = existingById.get(candidate.entityId);
    if (!current) {
      creates.push(candidate);
      continue;
    }

    const update: { area?: string | null; name?: string } = {};
    if (!current.area && candidate.area) {
      update.area = candidate.area;
    }
    const currentName = (current.name || '').trim();
    const isPlaceholder = currentName.length === 0 || currentName === candidate.entityId;
    if (isPlaceholder && candidate.name && candidate.name !== current.name) {
      update.name = candidate.name;
    }
    if (update.area !== undefined || update.name !== undefined) {
      updates.push({ entityId: candidate.entityId, data: update });
    }
  }

  if (creates.length === 0 && updates.length === 0) return;

  const ops = [];
  if (creates.length > 0) {
    ops.push(
      prisma.device.createMany({
        data: creates.map((c) => ({
          haConnectionId,
          entityId: c.entityId,
          name: c.name,
          area: c.area,
          label: null,
          blindTravelSeconds: null,
        })),
        skipDuplicates: true,
      })
    );
  }
  for (const u of updates) {
    ops.push(
      prisma.device.update({
        where: { haConnectionId_entityId: { haConnectionId, entityId: u.entityId } },
        data: u.data,
      })
    );
  }
  await prisma.$transaction(ops);
}

export async function captureMonitoringSnapshotForConnection(haConnectionId: number) {
  const devices = await getDevicesForHaConnection(haConnectionId);
  const totalDevices = devices.length;

  const monitoringCandidates = devices.filter((d) => {
    const group = getGroupLabel(d);
    return group === OTHER_LABEL || group === 'Sockets';
  });
  const monitoringDevices = monitoringCandidates.filter((d) => {
    const unit =
      typeof d.attributes?.unit_of_measurement === 'string'
        ? d.attributes.unit_of_measurement.trim()
        : '';
    const entityId = d.entityId.toLowerCase();
    const isBattery = entityId.includes('battery');
    const isKwh = unit.toLowerCase() === 'kwh';
    return isBattery || isKwh;
  });

  // Build candidate metadata for area/name backfill from the current HA snapshot.
  const metadataCandidatesFromSnapshot: MonitoringMetadataCandidate[] = monitoringDevices.map((d) => ({
    entityId: d.entityId,
    name: d.name ?? d.entityId,
    area: (d.area ?? d.areaName ?? null) as string | null,
  }));

  // Also include recently observed monitoring entities that still exist in HA.
  const observedSince = new Date(Date.now() - MONITORING_OBSERVED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const observedEntities = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId,
      capturedAt: { gte: observedSince },
      OR: [
        { unit: 'kWh' },
        { unit: '%', entityId: { contains: 'battery', mode: 'insensitive' } },
      ],
    },
    distinct: ['entityId'],
    select: { entityId: true },
  });
  const deviceByEntityId = new Map(devices.map((d) => [d.entityId, d]));
  const observedCandidates: MonitoringMetadataCandidate[] = [];
  for (const row of observedEntities.slice(0, MAX_OBSERVED_ENTITIES)) {
    const device = deviceByEntityId.get(row.entityId);
    if (!device) continue;
    observedCandidates.push({
      entityId: device.entityId,
      name: device.name ?? device.entityId,
      area: (device.area ?? device.areaName ?? null) as string | null,
    });
  }

  await upsertDeviceMetadataForMonitoringEntities(haConnectionId, [
    ...metadataCandidatesFromSnapshot,
    ...observedCandidates,
  ]);

  if (monitoringDevices.length === 0) {
    return {
      haConnectionId,
      totalDevices,
      monitoredCount: monitoringCandidates.length,
      insertedCount: 0,
    };
  }

  const data = monitoringDevices
    .map((d) => {
      const unitRaw =
        typeof d.attributes?.unit_of_measurement === 'string'
          ? d.attributes.unit_of_measurement.trim()
          : '';
      const unit = unitRaw.trim();
      const unitLower = unit.toLowerCase();
      const entityIdLower = d.entityId.toLowerCase();
      const isBattery = entityIdLower.includes('battery');
      const numeric = Number(d.state);

      if (!Number.isFinite(numeric)) return null;

      if (isBattery) {
        if (unit !== '%') return null;
        return {
          haConnectionId,
          entityId: d.entityId,
          state: String(d.state ?? ''),
          numericValue: numeric,
          unit: '%',
        };
      }

      if (unitLower !== 'kwh') return null;
      if (numeric <= 0) return null;

      return {
        haConnectionId,
        entityId: d.entityId,
        state: String(d.state ?? ''),
        numericValue: numeric,
        unit: 'kWh',
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const inserted = data.length
    ? await prisma.monitoringReading.createMany({ data })
    : { count: 0 };

  return {
    haConnectionId,
    totalDevices,
    monitoredCount: monitoringCandidates.length,
    insertedCount: inserted.count,
  };
}

export async function captureMonitoringSnapshotForAllConnections() {
  const connections = await prisma.haConnection.findMany({
    select: { id: true },
  });

  let totalDevices = 0;
  let monitoredCount = 0;
  let insertedCount = 0;

  for (const { id } of connections) {
    const summary = await captureMonitoringSnapshotForConnection(id);
    totalDevices += summary.totalDevices;
    monitoredCount += summary.monitoredCount;
    insertedCount += summary.insertedCount;
  }

  return {
    connections: connections.length,
    totalDevices,
    monitoredCount,
    insertedCount,
  };
}

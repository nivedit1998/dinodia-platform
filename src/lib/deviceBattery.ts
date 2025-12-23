import type { UIDevice } from '@/types/device';
import { getDeviceGroupingId } from '@/lib/deviceIdentity';

export type BatteryPercentByDeviceGroup = ReadonlyMap<string, number>;

function normalize(value: unknown) {
  return (value ?? '').toString().toLowerCase().trim();
}

function parseNumberLike(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/%$/, '').trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function hasBatteryKeyword(device: UIDevice) {
  const entityObjectId = device.entityId.split('.')[1] ?? device.entityId;
  const name = normalize(device.name);
  const entity = normalize(entityObjectId);
  const combined = `${name} ${entity}`;
  return combined.includes('battery');
}

function isBatteryVoltageLike(device: UIDevice) {
  const entityObjectId = device.entityId.split('.')[1] ?? device.entityId;
  const name = normalize(device.name);
  const entity = normalize(entityObjectId);
  const unit = normalize(device.attributes?.['unit_of_measurement']);
  if (name.includes('voltage') || entity.includes('voltage')) return true;
  if (unit && unit !== '%') return true;
  return false;
}

export function extractBatteryPercent(device: UIDevice): number | null {
  const deviceClass = normalize(device.attributes?.['device_class']);
  const unit = normalize(device.attributes?.['unit_of_measurement']);

  const fromState = clampPercent(parseNumberLike(device.state) ?? Number.NaN);
  if (fromState != null) {
    if (unit && unit !== '%') return null;
    return fromState;
  }

  const attrs = device.attributes ?? {};
  const keys = [
    'battery_level',
    'battery',
    'battery_percent',
    'battery_percentage',
    'battery_level_pct',
    'percentage',
  ] as const;
  for (const key of keys) {
    const raw = parseNumberLike(attrs[key]);
    if (raw == null) continue;
    const percent = clampPercent(raw);
    if (percent == null) continue;
    if (unit && unit !== '%') return null;
    if (deviceClass && deviceClass !== 'battery') {
      // If a non-battery device class happens to expose a "battery" attribute,
      // require an explicit % unit to avoid mislabeling voltage/energy sensors.
      if (unit !== '%') return null;
    }
    return percent;
  }

  return null;
}

export function buildBatteryPercentByDeviceGroup(devices: UIDevice[]) {
  const map = new Map<string, number>();

  for (const device of devices) {
    const deviceClass = normalize(device.attributes?.['device_class']);
    const isCandidate = deviceClass === 'battery' || hasBatteryKeyword(device);
    if (!isCandidate) continue;
    if (isBatteryVoltageLike(device) && deviceClass !== 'battery') continue;

    const percent = extractBatteryPercent(device);
    if (percent == null) continue;

    const groupId = getDeviceGroupingId(device);
    if (!groupId) continue;

    const prev = map.get(groupId);
    if (prev == null || percent < prev) {
      map.set(groupId, percent);
    }
  }

  return map;
}

export function getBatteryPercentForDevice(
  device: UIDevice,
  batteryByGroup: BatteryPercentByDeviceGroup
) {
  const groupId = getDeviceGroupingId(device);
  if (!groupId) return null;
  const value = batteryByGroup.get(groupId);
  return typeof value === 'number' ? value : null;
}

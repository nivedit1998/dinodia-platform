import { getPrimaryLabel } from '@/lib/deviceLabels';
import { UIDevice } from '@/types/device';

export type AlexaProperty = {
  namespace: string;
  name: string;
  value: unknown;
  timeOfSample: string;
  uncertaintyInMilliseconds: number;
  instance?: string;
};

export type AlexaDeviceStateLike = Pick<UIDevice, 'entityId' | 'state' | 'attributes'> &
  Partial<Pick<UIDevice, 'label' | 'labelCategory' | 'labels'>>;

const DEFAULT_UNCERTAINTY_MS = 500;
const BOILER_MIN_TEMP_C = 10;
const BOILER_MAX_TEMP_C = 40;

const ACTIVE_STATES = new Set(['on', 'open', 'playing', 'true', 'detected', 'armed']);
const DETECTION_STATES = new Set(['on', 'open', 'detected', 'motion', 'pressed', 'true']);

export function buildAlexaPropertiesForDevice(
  device: AlexaDeviceStateLike,
  fallbackLabel?: string | null
): AlexaProperty[] {
  const sampleTime = nowIso();
  const resolvedLabel = resolveDeviceLabel(device, fallbackLabel);
  if (!resolvedLabel) return [];
  const label = resolvedLabel.toLowerCase();
  const normalizedState = normalizedDeviceState(device.state);

  switch (label) {
    case 'light':
    case 'tv':
    case 'speaker': {
      return [
        buildPowerProperty({
          isOn: isActiveState(normalizedState),
          sampleTime,
        }),
      ];
    }
    case 'blind': {
      return [
        buildPowerProperty({
          isOn: isBlindOpenFromState(device.state, device.attributes),
          sampleTime,
        }),
      ];
    }
    case 'boiler': {
      const temperature = getNumericTemperature(device);
      if (temperature === null) return [];
      return [
        {
          namespace: 'Alexa.RangeController',
          instance: 'Boiler.Temperature',
          name: 'rangeValue',
          value: clamp(Math.round(temperature), BOILER_MIN_TEMP_C, BOILER_MAX_TEMP_C),
          timeOfSample: sampleTime,
          uncertaintyInMilliseconds: DEFAULT_UNCERTAINTY_MS,
        },
      ];
    }
    case 'motion sensor': {
      return [
        buildDetectionProperty({
          namespace: 'Alexa.MotionSensor',
          isDetected: isDetectionActive(normalizedState),
          sampleTime,
        }),
      ];
    }
    case 'doorbell':
    case 'home security': {
      return [
        buildDetectionProperty({
          namespace: 'Alexa.ContactSensor',
          isDetected: isDetectionActive(normalizedState),
          sampleTime,
        }),
      ];
    }
    default:
      return [];
  }
}

export function getBlindPosition(attributes: Record<string, unknown>): number | null {
  const keys = ['current_position', 'currentPosition', 'position'];
  for (const key of keys) {
    const raw = attributes[key];
    const parsed = parseNumber(raw);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function isBlindOpenFromState(state: string, attributes: Record<string, unknown>): boolean {
  const pos = getBlindPosition(attributes);
  if (pos !== null) {
    return pos > 0;
  }
  return isActiveState(normalizedDeviceState(state));
}

function resolveDeviceLabel(device: AlexaDeviceStateLike, fallback?: string | null) {
  if (fallback) return fallback;
  if (device.label || device.labels || device.labelCategory) {
    return getPrimaryLabel({
      label: device.label ?? null,
      labels: device.labels ?? [],
      labelCategory: device.labelCategory ?? null,
    });
  }
  return '';
}

function normalizedDeviceState(state: string) {
  return state ? state.toString().toLowerCase() : '';
}

function isActiveState(normalizedState: string) {
  return ACTIVE_STATES.has(normalizedState);
}

function isDetectionActive(normalizedState: string) {
  return DETECTION_STATES.has(normalizedState);
}

function buildPowerProperty({
  isOn,
  sampleTime,
}: {
  isOn: boolean;
  sampleTime: string;
}): AlexaProperty {
  return {
    namespace: 'Alexa.PowerController',
    name: 'powerState',
    value: isOn ? 'ON' : 'OFF',
    timeOfSample: sampleTime,
    uncertaintyInMilliseconds: DEFAULT_UNCERTAINTY_MS,
  };
}

function buildDetectionProperty({
  namespace,
  isDetected,
  sampleTime,
}: {
  namespace: 'Alexa.MotionSensor' | 'Alexa.ContactSensor';
  isDetected: boolean;
  sampleTime: string;
}): AlexaProperty {
  return {
    namespace,
    name: 'detectionState',
    value: isDetected ? 'DETECTED' : 'NOT_DETECTED',
    timeOfSample: sampleTime,
    uncertaintyInMilliseconds: DEFAULT_UNCERTAINTY_MS,
  };
}

function getNumericTemperature(device: AlexaDeviceStateLike): number | null {
  const fromState = parseNumber(device.state);
  if (fromState !== null) return fromState;
  return getNumericAttribute(device.attributes, [
    'temperature',
    'current_temperature',
    'currentTemperature',
  ]);
}

function getNumericAttribute(attributes: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = parseNumber(attributes[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nowIso() {
  return new Date().toISOString();
}

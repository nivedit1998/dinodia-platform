import registry from '@/config/labelRegistry.json';

const LABEL_CATEGORIES = registry.labelCategories as readonly string[];
export type LabelCategory = (typeof LABEL_CATEGORIES)[number];

const LABEL_MAP: Record<string, LabelCategory> = Object.fromEntries(
  Object.entries(registry.synonyms).map(([key, value]) => [key.toLowerCase(), value as LabelCategory])
);

export function classifyDeviceByLabel(
  labels: string[]
): LabelCategory | null {
  const lower = labels.map((l) => l.toLowerCase());
  for (const [key, cat] of Object.entries(LABEL_MAP)) {
    if (lower.includes(key)) return cat;
  }
  return null;
}

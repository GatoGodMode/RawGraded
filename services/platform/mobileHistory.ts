import { Preferences } from '@capacitor/preferences';

const HISTORY_KEY = 'rawgraded_studio_history';
const MAX_ENTRIES = 50;

export async function loadMobileHistory(): Promise<Record<string, unknown>[]> {
  const { value } = await Preferences.get({ key: HISTORY_KEY });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveMobileHistoryEntry(entry: Record<string, unknown>): Promise<{ ok: boolean }> {
  const list = await loadMobileHistory();
  const withMeta = {
    ...entry,
    savedAt: new Date().toISOString(),
  };
  const next = [withMeta, ...list].slice(0, MAX_ENTRIES);
  await Preferences.set({ key: HISTORY_KEY, value: JSON.stringify(next) });
  return { ok: true };
}

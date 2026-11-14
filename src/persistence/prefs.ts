/** localStorage-backed preferences (small, synchronous, JSON). */
const PREFIX = 'skybound:';

export function loadPrefs<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

export function savePrefs<T extends object>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: preferences simply don't persist */
  }
}

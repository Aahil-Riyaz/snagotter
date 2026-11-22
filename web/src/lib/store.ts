// Small persisted preferences + the Recent list (localStorage only, never sent anywhere).

export interface RecentItem {
  id: string;
  title: string;
  url: string;
  platform: string;
  filename: string | null;
  size: number | null;
  at: number;
}

const RECENT = "ytdown.recent";
const PREFS = "ytdown.prefs";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or private mode: the app still works */
  }
}

export const recent = {
  list: (): RecentItem[] => read<RecentItem[]>(RECENT, []),
  add(item: RecentItem) {
    const items = [item, ...recent.list().filter((r) => r.id !== item.id)].slice(0, 30);
    write(RECENT, items);
    return items;
  },
  clear() {
    write(RECENT, []);
    return [] as RecentItem[];
  },
};

export interface Prefs {
  compat: boolean;
  mode: "av" | "video" | "audio";
}
export const prefs = {
  get: (): Prefs => ({ compat: true, mode: "av", ...read<Partial<Prefs>>(PREFS, {}) }),
  set(p: Partial<Prefs>) {
    write(PREFS, { ...prefs.get(), ...p });
  },
};

export function getTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
export function setTheme(t: "light" | "dark") {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("ytdown.theme", t);
  } catch {
    /* ignore */
  }
  const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  meta.forEach((m) => (m.content = t === "dark" ? "#171715" : "#EEEDE8"));
}

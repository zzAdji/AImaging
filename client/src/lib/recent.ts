/* ------------------------------ Recent files ------------------------------ */

const RECENT_KEY = "aimaging.recentFiles";
const DB_NAME = "aimaging-fs";
const DB_STORE = "handles";
const DB_KEY = "lastFileHandle";
const MAX_RECENT = 8;

export interface RecentFile {
  name: string;
  ts: number;
  hasHandle: boolean;
  /**
   * Phase Database 4 (§13) : le data URL n'est plus la source principale
   * d'un fichier — simple cache de compatibilité. Les références distantes
   * prennent le relais dès qu'elles sont connues.
   */
  dataUrl?: string;
  dims?: { w: number; h: number };
  imageId?: string;
  examinationId?: string;
  storagePath?: string;
}

/** Références distantes facultatives attachées à un fichier récent. */
export interface RecentFileRefs {
  imageId?: string;
  examinationId?: string;
  storagePath?: string;
}

export function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentFile[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordRecent(
  name: string,
  dataUrl: string,
  dims?: { w: number; h: number },
  hasHandle = false,
  refs?: RecentFileRefs,
): void {
  const list = getRecentFiles().filter((f) => f.name !== name);
  list.unshift({ name, ts: Date.now(), hasHandle, dataUrl, dims, ...refs });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // storage full — retry without the data URL, then without this entry
    try {
      const slim = list.map((f) => ({ ...f, dataUrl: undefined }));
      localStorage.setItem(RECENT_KEY, JSON.stringify(slim.slice(0, MAX_RECENT)));
    } catch {
      /* ignore */
    }
  }
}

/* --------------------------- Last directory handle --------------------------- */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Last picked file handle — passed as startIn to the next open dialog so it
 *  starts in the same directory. */
export async function getLastFileHandle(): Promise<FileSystemFileHandle | null> {
  return idbGet();
}

export async function storeLastFileHandle(handle: FileSystemFileHandle): Promise<void> {
  try {
    await idbPut(handle);
  } catch {
    /* unavailable — ignore */
  }
}

export function openPickerIfAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === "function";
}

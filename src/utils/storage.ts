let saveVersion = 0;
let lastSavedVersion = 0;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: { name: string; value: any } | null = null;
const DEBOUNCE_TIME = 500;

// Open (or create) the IndexedDB database once and cache the promise
let dbPromise: Promise<IDBDatabase> | null = null;
// Keep a synchronous reference to the DB for use in beforeunload
let cachedDB: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('osivibe-db', 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('store')) {
        db.createObjectStore('store');
      }
    };
    request.onsuccess = () => {
      cachedDB = request.result;
      resolve(request.result);
    };
    request.onerror = () => {
      dbPromise = null; // Allow retry on failure
      reject(request.error);
    };
  });
  return dbPromise;
};

// Perform the actual IndexedDB write and return a promise that resolves
// when the transaction completes (not just when it's queued).
const writeToIDB = async (name: string, value: any): Promise<void> => {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const transaction = db.transaction('store', 'readwrite');
      const store = transaction.objectStore('store');
      store.put(value, name);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    } catch (e) {
      console.error('IndexedDB transaction error:', e);
      reject(e);
    }
  });
};

// Flush any pending debounced write immediately.
// Called on beforeunload to prevent data loss.
const flushPendingWrite = (): void => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (pendingWrite) {
    const { name, value } = pendingWrite;
    pendingWrite = null;
    // Use the already-cached DB connection for synchronous transaction start.
    // IndexedDB transactions started synchronously during beforeunload will
    // complete even after the page begins to unload (per spec).
    // CRITICAL: Do NOT open a new indexedDB.open() here — it's async and
    // the onsuccess callback may never fire during page teardown.
    if (cachedDB) {
      try {
        const transaction = cachedDB.transaction('store', 'readwrite');
        const store = transaction.objectStore('store');
        store.put(value, name);
      } catch (e) {
        console.error('IndexedDB flush error:', e);
      }
    } else {
      // Fallback: try opening a new connection (unreliable during unload)
      try {
        const request = indexedDB.open('osivibe-db', 1);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('store', 'readwrite');
          const store = transaction.objectStore('store');
          store.put(value, name);
        };
      } catch (e) {
        console.error('IndexedDB flush fallback error:', e);
      }
    }
  }
};

// Register beforeunload handler to flush pending writes
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingWrite);
}

// Cleanup function for HMR and app unmount
// This prevents memory leaks and state pollution across hot reloads
const cleanup = (): void => {
  flushPendingWrite();
  saveVersion = 0;
  lastSavedVersion = 0;
};

// Exported cleanup function for manual invocation
// Use this when unmounting the app or during HMR
export const cleanupStorage = (): void => {
  cleanup();
};

export const indexedDBStorage = {
  getItem: async (name: string) => {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction('store', 'readonly');
          const store = transaction.objectStore('store');
          const getRequest = store.get(name);
          getRequest.onsuccess = () => resolve(getRequest.result ?? null);
          getRequest.onerror = () => reject(getRequest.error);
        } catch (e) {
          // Store might not exist yet or other error
          resolve(null);
        }
      });
    } catch (e) {
      console.error('IndexedDB getItem error:', e);
      return null;
    }
  },

  setItem: async (name: string, value: any) => {
    // Increment version on every call — this replaces the broken
    // JSON.stringify comparison which couldn't handle File objects.
    saveVersion++;
    const thisVersion = saveVersion;

    // Store the pending write so it can be flushed on beforeunload
    pendingWrite = { name, value };

    // Clear any existing debounce timer
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Debounce writes to avoid overwhelming IndexedDB during rapid state changes,
    // but the actual write is awaited (not fire-and-forget).
    return new Promise<void>((resolve) => {
      saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        // Only write if no newer version has been queued
        if (thisVersion < saveVersion) {
          resolve();
          return;
        }
        try {
          await writeToIDB(name, value);
          lastSavedVersion = thisVersion;
          pendingWrite = null;
        } catch (e) {
          console.error('IndexedDB setItem error:', e);
        }
        resolve();
      }, DEBOUNCE_TIME);
    });
  },

  removeItem: async (name: string) => {
    try {
      const db = await openDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('store', 'readwrite');
        const store = transaction.objectStore('store');
        const deleteRequest = store.delete(name);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
    } catch (e) {
      console.error('IndexedDB removeItem error:', e);
    }
  },
};

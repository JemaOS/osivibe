let lastSavedJson: string | null = null;
let saveTimeout: any = null;
const DEBOUNCE_TIME = 1000;

export const indexedDBStorage = {
  getItem: async (name: string) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('osivibe-db', 1);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('store')) {
          db.createObjectStore('store');
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        try {
          const transaction = db.transaction('store', 'readonly');
          const store = transaction.objectStore('store');
          const getRequest = store.get(name);
          
          getRequest.onsuccess = () => {
            const result = getRequest.result;
            if (result) {
              try {
                lastSavedJson = JSON.stringify(result);
              } catch (e) {}
            }
            resolve(result);
          };
          
          getRequest.onerror = () => reject(getRequest.error);
        } catch (e) {
          // Store might not exist yet or other error
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  },

  setItem: async (name: string, value: any) => {
    let currentJson = '';
    try {
      currentJson = JSON.stringify(value);
    } catch (e) {
      currentJson = 'error-' + Date.now();
    }

    if (lastSavedJson === currentJson) {
      return Promise.resolve();
    }

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    return new Promise<void>((resolve) => {
      saveTimeout = setTimeout(() => {
        lastSavedJson = currentJson;
        const request = indexedDB.open('osivibe-db', 1);
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store');
          }
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            const transaction = db.transaction('store', 'readwrite');
            const store = transaction.objectStore('store');
            store.put(value, name);
          } catch (e) {
            console.error('IndexedDB transaction error:', e);
          }
        };
      }, DEBOUNCE_TIME);
      resolve();
    });
  },

  removeItem: async (name: string) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('osivibe-db', 1);
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction('store', 'readwrite');
        const store = transaction.objectStore('store');
        const deleteRequest = store.delete(name);
        
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };

      request.onerror = () => reject(request.error);
    });
  },
};

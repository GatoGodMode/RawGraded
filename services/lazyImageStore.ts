/**
 * lazyImageStore handles persistent caching of Base64 images for certificates
 * using the browser's IndexedDB. This avoids massive JSON payloads and 
 * speeds up vault loading for returning users.
 */

const DB_NAME = 'RawGradedVault';
const DB_VERSION = 1;
const STORE_NAME = 'certificate_images';

let dbPromise: Promise<IDBDatabase> | null = null;

const getDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return dbPromise;
};

export const lazyImageStore = {
    async getImage(id: string): Promise<{ front: string | null; back: string | null } | null> {
        const db = await getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                if (request.result) {
                    resolve({
                        front: request.result.front,
                        back: request.result.back
                    });
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    },

    async saveImage(id: string, front: string | null, back: string | null): Promise<void> {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ id, front, back, timestamp: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async clearCache(): Promise<void> {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async fetchAndCache(id: string, userId: string): Promise<{ front: string | null; back: string | null }> {
        // Try cache first
        const cached = await this.getImage(id);
        if (cached) return cached;

        // Fetch from API
        try {
            const response = await fetch(`api/collection.php?action=fetch_image&id=${id}&user_id=${userId}`);
            const data = await response.json();

            if (data.front_img || data.back_img) {
                await this.saveImage(id, data.front_img, data.back_img);
                return { front: data.front_img, back: data.back_img };
            }
        } catch (e) {
            console.error(`Failed to fetch image for ${id}`, e);
        }

        return { front: null, back: null };
    }
};

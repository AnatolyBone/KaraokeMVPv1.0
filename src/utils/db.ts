const DB_NAME = 'karaoke_lrc_maker_db';
const STORE_NAME = 'audio_store';
const FILE_KEY = 'current_audio';
const COVER_KEY = 'current_cover';

function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = () => reject(request.error);
  });
}

function saveBlobByKey(file: File | Blob, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openMediaDB().then((db) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const putRequest = store.put(file, key);

      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    }).catch(reject);
  });
}

function loadBlobByKey<T extends File | Blob>(key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    openMediaDB().then((db) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(key);

      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
    }).catch(() => resolve(null));
  });
}

function clearBlobByKey(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    openMediaDB().then((db) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const deleteRequest = store.delete(key);

      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    }).catch(() => resolve());
  });
}

const projectAudioKey = (projectId: string) => `project:${projectId}:audio`;
const projectCoverKey = (projectId: string) => `project:${projectId}:cover`;

export function saveAudioToDB(file: File): Promise<void> {
  return saveBlobByKey(file, FILE_KEY);
}

export function loadAudioFromDB(): Promise<File | null> {
  return loadBlobByKey<File>(FILE_KEY);
}

export function clearAudioFromDB(): Promise<void> {
  return clearBlobByKey(FILE_KEY);
}

export function saveCoverToDB(file: File | Blob): Promise<void> {
  return saveBlobByKey(file, COVER_KEY);
}

export function loadCoverFromDB(): Promise<File | Blob | null> {
  return loadBlobByKey<File | Blob>(COVER_KEY);
}

export function clearCoverFromDB(): Promise<void> {
  return clearBlobByKey(COVER_KEY);
}

export function saveProjectAudioToDB(projectId: string, file: File): Promise<void> {
  return saveBlobByKey(file, projectAudioKey(projectId));
}

export function loadProjectAudioFromDB(projectId: string): Promise<File | null> {
  return loadBlobByKey<File>(projectAudioKey(projectId));
}

export function saveProjectCoverToDB(projectId: string, file: File | Blob): Promise<void> {
  return saveBlobByKey(file, projectCoverKey(projectId));
}

export function loadProjectCoverFromDB(projectId: string): Promise<File | Blob | null> {
  return loadBlobByKey<File | Blob>(projectCoverKey(projectId));
}

export async function clearProjectMediaFromDB(projectId: string): Promise<void> {
  await Promise.all([
    clearBlobByKey(projectAudioKey(projectId)),
    clearBlobByKey(projectCoverKey(projectId)),
  ]);
}

export interface WorkerStore {
  delete: (key: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
}

export function createMemoryStore(): WorkerStore {
  const map = new Map<string, string>();
  return {
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(map.get(key) ?? null),
    put: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}

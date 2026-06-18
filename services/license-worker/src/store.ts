export interface LicenseStore {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
}

export function createMemoryStore(): LicenseStore {
  const map = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(map.get(key) ?? null),
    put: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}

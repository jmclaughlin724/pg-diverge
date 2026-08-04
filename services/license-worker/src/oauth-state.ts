export interface OAuthStateCoordinatorStore {
  transaction: <T>(
    callback: (transaction: OAuthStateCoordinatorTransaction) => Promise<T>
  ) => Promise<T>;
}

export interface OAuthStateCoordinatorTransaction {
  get: (key: string) => Promise<unknown | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
  setAlarm: (scheduledTime: number) => Promise<void>;
}

export interface OAuthStateCoordinatorStub {
  consume: (expiresAt: number, nowSeconds: number) => Promise<boolean>;
}

export interface OAuthStateNamespace {
  getByName: (nonce: string) => OAuthStateCoordinatorStub;
}

const consumedStateKey = "consumed";

function isUnixTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export async function consumeOAuthState(
  coordinator: OAuthStateCoordinatorStore,
  expiresAt: number,
  nowSeconds: number
): Promise<boolean> {
  if (!(isUnixTimestamp(expiresAt) && isUnixTimestamp(nowSeconds)) || expiresAt <= nowSeconds) {
    return false;
  }
  return await coordinator.transaction(async (transaction) => {
    if ((await transaction.get(consumedStateKey)) !== undefined) {
      return false;
    }
    await transaction.put(consumedStateKey, expiresAt);
    await transaction.setAlarm(expiresAt * 1000);
    return true;
  });
}

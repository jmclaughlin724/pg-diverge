import { DurableObject } from "cloudflare:workers";
import { createPrivateKey } from "node:crypto";
import { handleLicenseWorker, type LicenseWorkerEnv } from "./index.js";
import {
  consumeOAuthState,
  type OAuthStateCoordinatorStore,
  type OAuthStateCoordinatorTransaction,
} from "./oauth-state.js";
import {
  coordinatedSubscriptionLicense,
  coordinateSubscriptionRenewal,
  type RenewalOutcome,
  type SubscriptionRenewalCoordinatorStore,
  type SubscriptionRenewalCoordinatorTransaction,
} from "./subscription-renewal.js";

export class SubscriptionRenewalCoordinator extends DurableObject<LicenseWorkerEnv> {
  license(subscriptionId: string, sessionId: string): Promise<string | null> {
    return coordinatedSubscriptionLicense(
      this.coordinatorStore(),
      this.env.LICENSE_KV,
      subscriptionId,
      sessionId
    );
  }

  renew(subscriptionId: string, renewal: unknown, nowSeconds: number): Promise<RenewalOutcome> {
    return coordinateSubscriptionRenewal(
      this.coordinatorStore(),
      this.env.LICENSE_KV,
      createPrivateKey(this.env.SUPASCHEMA_LICENSE_PRIVATE_KEY),
      subscriptionId,
      renewal,
      nowSeconds
    );
  }

  private coordinatorStore(): SubscriptionRenewalCoordinatorStore {
    return {
      get: (key: string) => this.ctx.storage.get(key),
      transaction: <T>(
        callback: (transaction: SubscriptionRenewalCoordinatorTransaction) => Promise<T>
      ) => this.ctx.storage.transaction(callback),
    };
  }
}

export class OAuthStateCoordinator extends DurableObject<LicenseWorkerEnv> {
  consume(expiresAt: number, nowSeconds: number): Promise<boolean> {
    return consumeOAuthState(this.coordinatorStore(), expiresAt, nowSeconds);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private coordinatorStore(): OAuthStateCoordinatorStore {
    return {
      transaction: <T>(callback: (transaction: OAuthStateCoordinatorTransaction) => Promise<T>) =>
        this.ctx.storage.transaction(callback),
    };
  }
}

const worker = {
  fetch(request: Request, env: LicenseWorkerEnv): Promise<Response> {
    return handleLicenseWorker(
      request,
      env,
      { contracts: env.CONTRACT_KV, licenses: env.LICENSE_KV },
      Math.floor(Date.now() / 1000),
      globalThis.fetch
    );
  },
};

export default worker;

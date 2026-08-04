import { createPublicKey, type KeyObject } from "node:crypto";
import {
  canonicalRepo,
  issueLicenseToken,
  licenseClaimsThrough,
  verifyLicenseToken,
} from "./issue.js";
import type { WorkerStore } from "./store.js";

export interface InvoicePaidPeriod {
  paidThrough: number;
  priceId: string;
  subscriptionId?: string;
}

export interface InvoiceRenewal {
  invoiceId: string;
  periods: InvoicePaidPeriod[];
  subscriptionId: string;
}

export type RenewalOutcome =
  | { kind: "idempotent" | "ignored" | "invalid" | "unavailable" }
  | { kind: "renewed"; repo: string };

export interface SubscriptionRecord {
  lastInvoiceId?: string;
  paidThrough: number;
  plan: string;
  priceId: string;
  repo: string;
  sessionId: string;
}

export interface SubscriptionRenewalCoordinatorStore {
  get: (key: string) => Promise<unknown | undefined>;
  transaction: <T>(
    callback: (transaction: SubscriptionRenewalCoordinatorTransaction) => Promise<T>
  ) => Promise<T>;
}

export interface SubscriptionRenewalCoordinatorTransaction {
  get: (key: string) => Promise<unknown | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
}

export interface SubscriptionRenewalStub {
  license: (subscriptionId: string, sessionId: string) => Promise<string | null>;
  renew: (
    subscriptionId: string,
    renewal: InvoiceRenewal,
    nowSeconds: number
  ) => Promise<RenewalOutcome>;
}

export interface SubscriptionRenewalNamespace {
  getByName: (coordinatorId: string) => SubscriptionRenewalStub;
}

interface SubscriptionLicenseState {
  record: SubscriptionRecord;
  token: string;
}

interface SubscriptionLicenseSigningContext {
  privateKey: KeyObject;
  publicKeyPem: string;
}

type SubscriptionLicenseInitialization =
  | { kind: "incomplete" | "missing" }
  | { kind: "ready"; state: SubscriptionLicenseState };

const subscriptionLicenseStateKey = "license";

function asObject(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isUnixTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function subscriptionRecordFromValue(value: unknown): SubscriptionRecord | null {
  const record = asObject(value);
  if (record === null) {
    return null;
  }
  const sessionId = property(record, "sessionId");
  const repo = property(record, "repo");
  const plan = property(record, "plan");
  const priceId = property(record, "priceId");
  const paidThrough = property(record, "paidThrough");
  const lastInvoiceId = property(record, "lastInvoiceId");
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof repo !== "string" ||
    repo.length === 0 ||
    typeof plan !== "string" ||
    plan.length === 0 ||
    typeof priceId !== "string" ||
    priceId.length === 0 ||
    !isUnixTimestamp(paidThrough) ||
    (lastInvoiceId !== undefined &&
      (typeof lastInvoiceId !== "string" || lastInvoiceId.length === 0))
  ) {
    return null;
  }
  return {
    ...(lastInvoiceId === undefined ? {} : { lastInvoiceId }),
    paidThrough,
    plan,
    priceId,
    repo,
    sessionId,
  };
}

export function parseSubscriptionRecord(raw: string): SubscriptionRecord | null {
  try {
    return subscriptionRecordFromValue(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseSubscriptionLicenseState(value: unknown): SubscriptionLicenseState | null {
  const state = asObject(value);
  if (state === null) {
    return null;
  }
  const rawRecord = property(state, "record");
  const token = property(state, "token");
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  const record = subscriptionRecordFromValue(rawRecord);
  return record === null ? null : { record, token };
}

function reconcileVerifiedSubscriptionLicenseState(
  state: SubscriptionLicenseState,
  signing: SubscriptionLicenseSigningContext
): SubscriptionLicenseState | null {
  const claims = verifyLicenseToken(state.token, signing.publicKeyPem);
  if (
    claims === null ||
    !isUnixTimestamp(claims.exp) ||
    claims.plan !== state.record.plan ||
    canonicalRepo(claims.repo) !== canonicalRepo(state.record.repo)
  ) {
    return null;
  }
  if (claims.exp > state.record.paidThrough) {
    return {
      record: { ...state.record, paidThrough: claims.exp },
      token: state.token,
    };
  }
  if (claims.exp < state.record.paidThrough) {
    return {
      record: state.record,
      token: issueLicenseToken(
        licenseClaimsThrough(state.record.repo, state.record.plan, state.record.paidThrough),
        signing.privateKey
      ),
    };
  }
  return state;
}

function laterMatchingSubscriptionLicenseState(
  current: SubscriptionLicenseState,
  candidate: SubscriptionLicenseState
): SubscriptionLicenseState | null {
  if (
    current.record.sessionId !== candidate.record.sessionId ||
    current.record.priceId !== candidate.record.priceId ||
    current.record.plan !== candidate.record.plan ||
    canonicalRepo(current.record.repo) !== canonicalRepo(candidate.record.repo)
  ) {
    return null;
  }
  return candidate.record.paidThrough > current.record.paidThrough ? candidate : current;
}

async function initializeSubscriptionLicenseState(
  coordinator: SubscriptionRenewalCoordinatorStore,
  licenses: WorkerStore,
  subscriptionId: string,
  signing: SubscriptionLicenseSigningContext
): Promise<SubscriptionLicenseInitialization> {
  const rawRecord = await licenses.get(subscriptionRecordKey(subscriptionId));
  const record = rawRecord === null ? null : parseSubscriptionRecord(rawRecord);
  if (record === null) {
    return { kind: "missing" };
  }
  const token = await licenses.get(record.sessionId);
  if (token === null || token.length === 0) {
    return { kind: "incomplete" };
  }
  const candidate = reconcileVerifiedSubscriptionLicenseState({ record, token }, signing);
  if (candidate === null) {
    return { kind: "incomplete" };
  }
  return coordinator.transaction(async (transaction) => {
    const stored = parseSubscriptionLicenseState(
      await transaction.get(subscriptionLicenseStateKey)
    );
    if (stored === null) {
      await transaction.put(subscriptionLicenseStateKey, candidate);
      return { kind: "ready", state: candidate };
    }
    const current = reconcileVerifiedSubscriptionLicenseState(stored, signing);
    if (current === null) {
      await transaction.put(subscriptionLicenseStateKey, candidate);
      return { kind: "ready", state: candidate };
    }
    const latest = laterMatchingSubscriptionLicenseState(current, candidate);
    if (latest === null) {
      return { kind: "incomplete" };
    }
    if (latest !== stored) {
      await transaction.put(subscriptionLicenseStateKey, latest);
    }
    return { kind: "ready", state: latest };
  });
}

export async function coordinatedSubscriptionLicense(
  coordinator: SubscriptionRenewalCoordinatorStore,
  _licenses: WorkerStore,
  _subscriptionId: string,
  sessionId: string
): Promise<string | null> {
  const state = parseSubscriptionLicenseState(await coordinator.get(subscriptionLicenseStateKey));
  return state?.record.sessionId === sessionId ? state.token : null;
}

export async function coordinateSubscriptionRenewal(
  coordinator: SubscriptionRenewalCoordinatorStore,
  licenses: WorkerStore,
  privateKey: KeyObject,
  subscriptionId: string,
  value: unknown,
  nowSeconds: number
): Promise<RenewalOutcome> {
  const renewal = parseInvoiceRenewal(value);
  if (
    renewal === null ||
    renewal.subscriptionId !== subscriptionId ||
    !isUnixTimestamp(nowSeconds)
  ) {
    return { kind: "invalid" };
  }
  const signing: SubscriptionLicenseSigningContext = {
    privateKey,
    publicKeyPem: createPublicKey(privateKey.export({ format: "pem", type: "pkcs8" }))
      .export({ format: "pem", type: "spki" })
      .toString(),
  };
  const initialized = await initializeSubscriptionLicenseState(
    coordinator,
    licenses,
    subscriptionId,
    signing
  );
  if (initialized.kind === "missing") {
    return { kind: "ignored" };
  }
  if (initialized.kind === "incomplete") {
    return { kind: "unavailable" };
  }
  return coordinator.transaction(async (transaction) => {
    const stored = parseSubscriptionLicenseState(
      await transaction.get(subscriptionLicenseStateKey)
    );
    if (stored === null) {
      return { kind: "unavailable" };
    }
    const current = reconcileVerifiedSubscriptionLicenseState(stored, signing);
    if (current === null) {
      return { kind: "unavailable" };
    }
    if (current !== stored) {
      await transaction.put(subscriptionLicenseStateKey, current);
    }
    const { record } = current;
    if (record.lastInvoiceId === renewal.invoiceId) {
      return { kind: "idempotent" };
    }
    const matchingPeriods = renewal.periods.filter(
      (period) =>
        period.priceId === record.priceId &&
        (period.subscriptionId === undefined || period.subscriptionId === renewal.subscriptionId)
    );
    const paidThrough = matchingPeriods.length === 1 ? matchingPeriods[0]?.paidThrough : undefined;
    if (paidThrough === undefined) {
      return { kind: "invalid" };
    }
    if (paidThrough <= record.paidThrough || paidThrough <= nowSeconds) {
      return { kind: "ignored" };
    }
    const nextRecord = { ...record, lastInvoiceId: renewal.invoiceId, paidThrough };
    const token = issueLicenseToken(
      licenseClaimsThrough(record.repo, record.plan, paidThrough),
      privateKey
    );
    await transaction.put(subscriptionLicenseStateKey, { record: nextRecord, token });
    return { kind: "renewed", repo: record.repo };
  });
}

export function parseInvoiceRenewal(value: unknown): InvoiceRenewal | null {
  const root = asObject(value);
  if (root === null) {
    return null;
  }
  const invoiceId = property(root, "invoiceId");
  const subscriptionId = property(root, "subscriptionId");
  const rawPeriods = property(root, "periods");
  if (
    typeof invoiceId !== "string" ||
    invoiceId.length === 0 ||
    typeof subscriptionId !== "string" ||
    subscriptionId.length === 0 ||
    !Array.isArray(rawPeriods)
  ) {
    return null;
  }
  const periods: InvoicePaidPeriod[] = [];
  for (const value of rawPeriods) {
    const period = asObject(value);
    if (period === null) {
      return null;
    }
    const paidThrough = property(period, "paidThrough");
    const priceId = property(period, "priceId");
    const periodSubscriptionId = property(period, "subscriptionId");
    if (
      !isUnixTimestamp(paidThrough) ||
      typeof priceId !== "string" ||
      priceId.length === 0 ||
      (periodSubscriptionId !== undefined &&
        (typeof periodSubscriptionId !== "string" || periodSubscriptionId.length === 0))
    ) {
      return null;
    }
    periods.push({
      paidThrough,
      priceId,
      ...(periodSubscriptionId === undefined ? {} : { subscriptionId: periodSubscriptionId }),
    });
  }
  return { invoiceId, periods, subscriptionId };
}

export function subscriptionRecordKey(subscriptionId: string): string {
  return `subscription:${subscriptionId}`;
}

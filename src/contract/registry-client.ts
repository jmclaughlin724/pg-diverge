import { isSchemaContract, type SchemaContract } from "./schema.js";

export interface ContractRegistryRequest {
  fetchImpl: typeof fetch;
  license: string;
  name: string;
  registryUrl: string;
  repo: string;
}

export interface PushContractRequest extends ContractRegistryRequest {
  contract: SchemaContract;
}

export function contractRegistryUrl(input: {
  name: string;
  registryUrl: string;
  repo: string;
}): string {
  const url = new URL("/contracts", input.registryUrl);
  url.searchParams.set("repo", input.repo);
  url.searchParams.set("name", input.name);
  return url.toString();
}

export async function pushContract(request: PushContractRequest): Promise<void> {
  const response = await request.fetchImpl(contractRegistryUrl(request), {
    body: JSON.stringify(request.contract),
    headers: {
      authorization: `Bearer ${request.license}`,
      "content-type": "application/json",
    },
    method: "PUT",
  });
  assertRegistryResponse(response, "push");
}

export async function pullContract(request: ContractRegistryRequest): Promise<SchemaContract> {
  const response = await request.fetchImpl(contractRegistryUrl(request), {
    headers: {
      authorization: `Bearer ${request.license}`,
    },
    method: "GET",
  });
  assertRegistryResponse(response, "pull");
  const contract: unknown = await response.json();
  if (!isSchemaContract(contract)) {
    throw new Error("contract registry pull returned an invalid schema contract");
  }
  return contract;
}

function assertRegistryResponse(response: Response, action: string): void {
  if (response.ok) {
    return;
  }
  throw new Error(`contract registry ${action} failed with HTTP ${response.status}`);
}

import { CosmosClient } from "@azure/cosmos";

const endpoint = process.env.COSMOS_ENDPOINT!;
const key = process.env.COSMOS_KEY!;
const dbName = process.env.COSMOS_DB ?? "line-hankan";

export const cosmos = new CosmosClient({ endpoint, key }).database(dbName);

export async function ensureCosmos() {
  try {
    await cosmos.containers.createIfNotExists({ id: "users", partitionKey: "/id" });
    await cosmos.containers.createIfNotExists({ id: "roles", partitionKey: "/role" });
  } catch (e) {
    console.error("[cosmos] ensure error", e);
    throw e;
  }
}

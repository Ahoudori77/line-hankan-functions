import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

const conn = process.env.AzureWebJobsStorage!;
const products = TableClient.fromConnectionString(conn, "Products");
const inventory = TableClient.fromConnectionString(conn, "Inventory");

type SiteCode = "M" | "Y" | "P" | "R";
interface ProductUpsert {
  managerId: string;
  productId: string;
  siteCode: SiteCode;
  price: number;
  title?: string;
  imageBlob?: string;
  isActive?: boolean;
  lowStockThreshold?: number;
}

app.http("admin-products", {
  methods: ["POST", "PUT"],
  authLevel: "function",
  route: "ops/products",
  handler: async (req: HttpRequest) => {
    const raw = await req.json().catch(() => null);
    const b = (raw ?? {}) as Partial<ProductUpsert>;
    const {
      managerId, productId, siteCode, price,
      title, imageBlob, isActive = true, lowStockThreshold
    } = b;

    if (!managerId || !productId || !siteCode || price == null) {
      return { status: 400, jsonBody: { error: "managerId, productId, siteCode, price は必須" } };
    }

    try { await products.createTable(); } catch {}
    try { await inventory.createTable(); } catch {}

    const now = new Date().toISOString();
    await products.upsertEntity({
      partitionKey: managerId,
      rowKey: productId,
      siteCode, price, title, imageBlob, isActive, lowStockThreshold, updatedAt: now
    }, "Merge");

    try { await inventory.getEntity(managerId, productId); }
    catch {
      await inventory.upsertEntity({
        partitionKey: managerId, rowKey: productId,
        qtyTotal: 0, qtyAvailable: 0, updatedAt: now
      }, "Merge");
    }
    return { jsonBody: { ok: true } };
  }
});

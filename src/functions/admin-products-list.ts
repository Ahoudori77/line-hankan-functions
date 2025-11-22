// src/functions/admin-products-list.ts
import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

const conn = process.env.AzureWebJobsStorage!;
const products = TableClient.fromConnectionString(conn, "Products");

app.http("admin-products-list", {
  methods: ["GET"],
  authLevel: "function",
  route: "ops/products/list",
  handler: async (req: HttpRequest) => {
    try {
      const managerId = req.query.get("managerId") || undefined;
      const siteCode = req.query.get("siteCode") || undefined;
      const top = Math.min(parseInt(req.query.get("top") || "100", 10), 500);

      const filters: string[] = [];
      if (managerId) filters.push(`managerId eq '${managerId}'`);
      if (siteCode)  filters.push(`siteCode  eq '${siteCode}'`);
      const filter = filters.join(" and ");

      const items: any[] = [];
      const iter = products.listEntities<any>({ queryOptions: filter ? { filter } : {} });
      for await (const e of iter) {
        items.push({
          productId: e.productId ?? e.rowKey,
          managerId: e.managerId,
          siteCode: e.siteCode,
          price: e.price,
          lowStockThreshold: e.lowStockThreshold ?? null,
          timestamp: e.timestamp
        });
        if (items.length >= top) break;
      }
      return { jsonBody: { ok: true, items } };
    } catch (e: any) {
      console.error("[products-list] error", e?.message);
      return { status: 500, jsonBody: { error: "list failed" } };
    }
  }
});

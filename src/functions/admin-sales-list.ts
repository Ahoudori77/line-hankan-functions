// src/functions/admin-sales-list.ts
import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

const conn = process.env.AzureWebJobsStorage!;
const orders = TableClient.fromConnectionString(conn, "Orders");

app.http("admin-sales-list", {
  methods: ["GET"],
  authLevel: "function",
  route: "ops/sales/recent",
  handler: async (req: HttpRequest) => {
    try {
      const top = Math.min(parseInt(req.query.get("top") || "50", 10), 200);
      const sellerUserId = req.query.get("sellerUserId") || undefined;

      const out: any[] = [];
      if (sellerUserId) {
        // 特定売り子のみ
        const iter = orders.listEntities<any>({
          queryOptions: { filter: `PartitionKey eq '${sellerUserId}'` }
        });
        for await (const e of iter) { out.push(e); }
      } else {
        // 全体（簡易：全スキャン→ソート→スライス）
        const iter = orders.listEntities<any>();
        for await (const e of iter) { out.push(e); }
      }

      out.sort((a,b)=> new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const items = out.slice(0, top).map(e => ({
        orderId: e.rowKey,
        sellerUserId: e.partitionKey,
        productId: e.productId ?? null,
        siteCode: e.siteCode ?? null,
        status: e.status ?? "unknown",
        imageBlob: e.imageBlob ?? null,
        updatedAt: e.updatedAt ?? e.timestamp
      }));
      return { jsonBody: { ok: true, items } };
    } catch (e: any) {
      console.error("[sales-list] error", e?.message);
      return { status: 500, jsonBody: { error: "list failed" } };
    }
  }
});

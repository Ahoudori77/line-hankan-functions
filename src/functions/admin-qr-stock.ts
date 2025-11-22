// src/functions/admin-qr-stock.ts
import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

const conn = process.env.AzureWebJobsStorage!;
const qr = TableClient.fromConnectionString(conn, "QrItems");

app.http("admin-qr-stock", {
  methods: ["GET"],
  authLevel: "function",
  route: "ops/qr/stock",
  handler: async (req: HttpRequest) => {
    try {
      const productId = req.query.get("productId") || undefined;

      // 単品
      if (productId) {
        let available = 0, used = 0, total = 0;
        const iter = qr.listEntities<any>({
          queryOptions: { filter: `PartitionKey eq '${productId}'` }
        });
        for await (const e of iter) {
          total++;
          if (e.status === "used") used++; else available++;
        }
        return { jsonBody: { ok: true, productId, total, available, used } };
      }

      // 全体集計
      const map = new Map<string, { total:number; available:number; used:number }>();
      const iter = qr.listEntities<any>();
      for await (const e of iter) {
        const pid = String(e.partitionKey);
        const rec = map.get(pid) || { total:0, available:0, used:0 };
        rec.total++;
        if (e.status === "used") rec.used++; else rec.available++;
        map.set(pid, rec);
      }
      const items = Array.from(map.entries()).map(([pid, v])=>({ productId: pid, ...v }));
      return { jsonBody: { ok: true, items } };
    } catch (e: any) {
      console.error("[qr-stock] error", e?.message);
      return { status: 500, jsonBody: { error: "stock failed" } };
    }
  }
});

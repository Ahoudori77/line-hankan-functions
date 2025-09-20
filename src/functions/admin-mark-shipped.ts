import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { Client } from "@line/bot-sdk";

const table = TableClient.fromConnectionString(process.env.AzureWebJobsStorage!, "Orders");
const line = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

app.http("admin-mark-shipped", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ops/mark-shipped",
  handler: async (req: HttpRequest) => {
    const key = req.headers.get("x-functions-key");
    if (!key || key !== process.env.ADMIN_API_KEY) {
      return { status: 401, jsonBody: { error: "unauthorized" } };
    }

    let body: any;
    try { body = await req.json(); } catch { /* noop */ }

    const orderId: string = body?.orderId;
    const sellerUserId: string = body?.sellerUserId;
    if (!orderId || !sellerUserId) {
      return { status: 400, jsonBody: { error: "orderId, sellerUserId は必須です" } };
    }

    // ステータス更新
    await table.upsertEntity({
      partitionKey: sellerUserId,
      rowKey: orderId,
      status: "shipped",
      updatedAt: new Date().toISOString()
    }, "Merge");

    // 売り子へ通知
    await line.pushMessage(sellerUserId, {
      type: "text",
      text: `注文 ${orderId} を発送済みに更新しました。お疲れさまでした！`
    });

    return { jsonBody: { ok: true } };
  }
});


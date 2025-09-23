// admin-upload.ts
import { app, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob"; // ⬅ SAS系は削除
import { TableClient } from "@azure/data-tables";
import { Client } from "@line/bot-sdk";

const storageConn = process.env.AzureWebJobsStorage!;
const blob = BlobServiceClient.fromConnectionString(storageConn);
const table = TableClient.fromConnectionString(storageConn, "Orders");
const line = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

async function ensureInit() {
  try { await table.createTable(); } catch { /* 既存ならOK */ }
  await blob.getContainerClient("qrcodes").createIfNotExists();
}

function guessContentType(filename: string) {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

// 自アプリのベースURLを取得（本番: WEBSITE_HOSTNAME / ローカル: req.url から）
function getBaseUrl(req: HttpRequest): string {
  const host = process.env.WEBSITE_HOSTNAME;
  if (host) return `https://${host}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

app.http("admin-upload", {
  methods: ["POST"],
  authLevel: "anonymous",  // ←いまは手動キー検証。将来 "function" 推奨
  route: "ops/upload",
  handler: async (req: HttpRequest) => {
    // 手動APIキーチェック
    const key = req.headers.get("x-functions-key");
    if (!key || key !== process.env.ADMIN_API_KEY) {
      return { status: 401, jsonBody: { error: "unauthorized" } };
    }

    await ensureInit();

    // 入力
    let body: any;
    try { body = await req.json(); } catch {}
    const orderId: string = body?.orderId;
    const sellerUserId: string = body?.sellerUserId;
    const filename: string = body?.filename ?? "qr.jpg";
    const contentBase64: string = body?.contentBase64;
    if (!orderId || !sellerUserId || !contentBase64) {
      return { status: 400, jsonBody: { error: "orderId, sellerUserId, contentBase64 は必須です" } };
    }

    // Blob 保存
    const container = blob.getContainerClient("qrcodes");
    const blobName = `${orderId}/${filename}`;
    const block = container.getBlockBlobClient(blobName);
    const buf = Buffer.from(contentBase64, "base64");
    await block.uploadData(buf, { blobHTTPHeaders: { blobContentType: guessContentType(filename) } });

    // テーブル更新（idempotent Merge）
    await table.upsertEntity({
      partitionKey: sellerUserId,
      rowKey: orderId,
      status: "image_uploaded",
      imageBlob: blobName,
      updatedAt: new Date().toISOString(),
    }, "Merge");

    // 常に image-proxy URL でプッシュ（SAS不要）
    const proxyUrl = `${getBaseUrl(req)}/api/img/${sellerUserId}/${orderId}`;

    let pushed = false;
    try {
      await line.pushMessage(sellerUserId, {
        type: "image",
        originalContentUrl: proxyUrl,
        previewImageUrl: proxyUrl,
      });
      pushed = true;
    } catch (e: any) {
      console.error("[admin-upload] push error", e?.statusCode, e?.originalError ?? e);
      // フォールバックでテキストだけ送る（失敗しても握る）
      try {
        await line.pushMessage(sellerUserId, {
          type: "text",
          text: `QR画像を登録しました（orderId: ${orderId}, file: ${filename}）。`,
        });
      } catch {}
    }

    return { jsonBody: { ok: true, blobName, proxyUrl, pushed } };
  }
});

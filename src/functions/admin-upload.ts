// admin-upload.ts
import { app, HttpRequest } from "@azure/functions";
import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { Client } from "@line/bot-sdk";

const storageConn = process.env.AzureWebJobsStorage!;
const blob = BlobServiceClient.fromConnectionString(storageConn);
const table = TableClient.fromConnectionString(storageConn, "Orders");
const line = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

async function ensureInit() {
  try { await table.createTable(); } catch { /* 既存ならOK */ }
  const container = blob.getContainerClient("qrcodes");
  await container.createIfNotExists();
}

function guessContentType(filename: string) {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/**
 * 本番ストレージ用: 短期SAS URLを生成して返す
 * ※ローカルの Azurite (UseDevelopmentStorage=true) では外部公開されないので null を返す
 */
function buildBlobSasUrl(containerName: string, blobName: string, minutes = 15): string | null {
  // エミュレータの場合はSASを作っても外から見えないのでスキップ
  if (/UseDevelopmentStorage=true/i.test(storageConn)) return null;

  const accountName = /AccountName=([^;]+)/i.exec(storageConn)?.[1];
  const accountKey  = /AccountKey=([^;]+)/i.exec(storageConn)?.[1];
  if (!accountName || !accountKey) return null;

  const cred = new StorageSharedKeyCredential(accountName, accountKey);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + minutes * 60 * 1000),
      protocol: SASProtocol.HttpsAndHttp,
    },
    cred
  ).toString();

  const url = blob.getContainerClient(containerName).getBlobClient(blobName).url;
  return `${url}?${sas}`;
}

app.http("admin-upload", {
  methods: ["POST"],
  authLevel: "anonymous",       // 今は手動キー検証。将来は "function" にするとより安全
  route: "ops/upload",
  handler: async (req: HttpRequest) => {
    // 手動APIキーチェック
    const key = req.headers.get("x-functions-key");
    if (!key || key !== process.env.ADMIN_API_KEY) {
      return { status: 401, jsonBody: { error: "unauthorized" } };
    }

    await ensureInit();

    // 入力取り出し
    let body: any;
    try { body = await req.json(); } catch { /* noop */ }

    const orderId: string = body?.orderId;
    const sellerUserId: string = body?.sellerUserId; // 売り子LINE userId
    const filename: string = body?.filename ?? "qr.jpg";
    const contentBase64: string = body?.contentBase64;

    if (!orderId || !sellerUserId || !contentBase64) {
      return { status: 400, jsonBody: { error: "orderId, sellerUserId, contentBase64 は必須です" } };
    }

    // Blob へ保存
    const container = blob.getContainerClient("qrcodes");
    const blobName = `${orderId}/${filename}`;
    const block = container.getBlockBlobClient(blobName);

    const buf = Buffer.from(contentBase64, "base64");
    await block.uploadData(buf, {
      blobHTTPHeaders: { blobContentType: guessContentType(filename) }
    });

    // 注文ステータス更新（idempotentにMerge）
    await table.upsertEntity({
      partitionKey: sellerUserId,
      rowKey: orderId,
      status: "image_uploaded",
      imageBlob: blobName,
      updatedAt: new Date().toISOString(),
    }, "Merge");

    // 本番は画像URLをSASで作って image push。ローカル/Azuriteは見えないのでテキスト通知。
    const fileUrl = buildBlobSasUrl("qrcodes", blobName, 15);
    if (process.env.NODE_ENV === "production" && fileUrl) {
      await line.pushMessage(sellerUserId, {
        type: "image",
        originalContentUrl: fileUrl,
        previewImageUrl: fileUrl,
      });
    } else {
      await line.pushMessage(sellerUserId, {
        type: "text",
        text: `QR画像を登録しました（orderId: ${orderId}, file: ${filename}）。`,
      });
    }

    return { jsonBody: { ok: true, blobName, fileUrl: fileUrl ?? undefined } };
  }
});

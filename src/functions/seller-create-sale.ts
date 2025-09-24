import { app, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { Client } from "@line/bot-sdk";

const conn = process.env.AzureWebJobsStorage!;
const blob = BlobServiceClient.fromConnectionString(conn);
const tblSales  = TableClient.fromConnectionString(conn, "Sales");
const tblQR     = TableClient.fromConnectionString(conn, "QRPool");
const tblOrders = TableClient.fromConnectionString(conn, "Orders");
const line = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

type SiteCode = "M" | "Y" | "P" | "R";
interface CreateSaleBody {
  sellerUserId: string;
  managerId?: string;
  productId: string;
  siteCode: SiteCode;
  price?: number;
  shippingCode: string;
  evidenceBase64?: string;
}

function baseUrl(req: HttpRequest) {
  return process.env.WEBSITE_HOSTNAME
    ? `https://${process.env.WEBSITE_HOSTNAME}`
    : new URL(req.url).origin;
}

app.http("seller-create-sale", {
  methods: ["POST"],
  authLevel: "anonymous", // 将来 LIFF で本人確認を追加
  route: "sales",
  handler: async (req: HttpRequest) => {
    const raw = await req.json().catch(() => null);
    const b = (raw ?? {}) as Partial<CreateSaleBody>;
    const { sellerUserId, managerId, productId, siteCode, price, shippingCode, evidenceBase64 } = b;

    if (!sellerUserId || !productId || !siteCode || !shippingCode) {
      return { status: 400, jsonBody: { error: "sellerUserId, productId, siteCode, shippingCode は必須" } };
    }

    try { await tblSales.createTable(); } catch {}
    try { await tblQR.createTable(); } catch {}
    try { await tblOrders.createTable(); } catch {}

    // 証跡スクショ（任意）
    let evidenceBlob: string | undefined;
    if (evidenceBase64) {
      const containerEvidence = blob.getContainerClient("evidence");
      await containerEvidence.createIfNotExists();
      const saleFolder = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0,14) + "-" + Math.random().toString(36).slice(2,6);
      evidenceBlob = `evidence/${saleFolder}/screenshot.jpg`;
      await containerEvidence.getBlockBlobClient(`${saleFolder}/screenshot.jpg`)
        .uploadData(Buffer.from(String(evidenceBase64), "base64"), { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
    }

    // QR を1枚だけ確保（available → assigned）※ ETag で原子的に
    let picked: any | undefined;
    const iter = tblQR.listEntities<any>({ queryOptions: { filter: `PartitionKey eq '${productId}' and status eq 'available'` } });
    for await (const e of iter) { picked = e; break; }
    if (!picked) return { status: 409, jsonBody: { error: "QR在庫が不足しています" } };

    const now = new Date().toISOString();
    await tblQR.updateEntity({
      partitionKey: picked.partitionKey,
      rowKey: picked.rowKey,
      status: "assigned",
      assignedToSaleId: "pending",
      updatedAt: now
    }, "Merge", { etag: picked.etag });

    // Sales 行の作成
    const saleId = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    await tblSales.upsertEntity({
      partitionKey: sellerUserId,
      rowKey: saleId,
      managerId, productId, siteCode, priceAtSale: price, shippingCode,
      evidenceBlob, qrBlob: picked.qrBlob, status: "submitted", createdAt: now, updatedAt: now
    }, "Merge");

    // Orders にも反映（image-proxy 用）
    await tblOrders.upsertEntity({
      partitionKey: sellerUserId,
      rowKey: saleId,
      status: "image_uploaded",
      imageBlob: picked.qrBlob,
      updatedAt: now
    }, "Merge");

    // picked に saleId を書き戻し（任意）
    try {
      await tblQR.updateEntity({
        partitionKey: picked.partitionKey, rowKey: picked.rowKey,
        assignedToSaleId: saleId, updatedAt: new Date().toISOString()
      }, "Merge");
    } catch {}

    // LINE 画像 push（proxy URL）
    const proxyUrl = `${baseUrl(req)}/api/img/${sellerUserId}/${saleId}`;
    try {
      await line.pushMessage(sellerUserId, { type: "image", originalContentUrl: proxyUrl, previewImageUrl: proxyUrl });
    } catch (e: any) {
      console.error("[seller-create-sale] push error", e?.statusCode, e?.originalError ?? e);
    }

    return { jsonBody: { ok: true, saleId, proxyUrl } };
  }
});

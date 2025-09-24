import { app, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

const conn = process.env.AzureWebJobsStorage!;
const blob = BlobServiceClient.fromConnectionString(conn);
const qrpool = TableClient.fromConnectionString(conn, "QRPool");

interface QrBulkItem { filename?: string; contentBase64: string }
interface QrBulkBody  { productId: string; items: QrBulkItem[] }

function guessCT(name: string) {
  const n = name.toLowerCase();
  return (n.endsWith(".jpg") || n.endsWith(".jpeg")) ? "image/jpeg" : "image/png";
}

app.http("admin-add-qr-bulk", {
  methods: ["POST"],
  authLevel: "function",
  route: "ops/qr/bulk",
  handler: async (req: HttpRequest) => {
    const raw = await req.json().catch(() => null);
    const b = (raw ?? {}) as Partial<QrBulkBody>;
    const productId = b.productId;
    const items = b.items ?? [];

    if (!productId || items.length === 0) {
      return { status: 400, jsonBody: { error: "productId と items[] が必要" } };
    }

    try { await qrpool.createTable(); } catch {}
    const container = blob.getContainerClient("qrcodes");
    await container.createIfNotExists();

    const now = new Date().toISOString();
    for (const it of items) {
      const filename: string = it.filename || `${randomUUID()}.png`;
      const qrId = randomUUID();
      const blobName = `pool/${productId}/${filename}`;
      const block = container.getBlockBlobClient(blobName);
      const buf = Buffer.from(String(it.contentBase64), "base64");
      await block.uploadData(buf, { blobHTTPHeaders: { blobContentType: guessCT(filename) } });
      await qrpool.upsertEntity({
        partitionKey: productId, rowKey: qrId,
        qrBlob: blobName, status: "available", updatedAt: now
      }, "Merge");
    }
    return { jsonBody: { ok: true } };
  }
});

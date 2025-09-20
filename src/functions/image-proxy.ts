import { app, HttpRequest } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";

const conn = process.env.AzureWebJobsStorage!;
const blob = BlobServiceClient.fromConnectionString(conn);
const table = TableClient.fromConnectionString(conn, "Orders");

app.http("image-proxy", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "img/{sellerUserId}/{orderId}",
  handler: async (req: HttpRequest) => {
    const sellerUserId = req.params.sellerUserId;
    const orderId = req.params.orderId;

    if (!sellerUserId || !orderId) {
      return { status: 400, body: "bad request" };
    }

    try {
      // Orders: partitionKey = sellerUserId, rowKey = orderId
      const row = await table.getEntity<any>(sellerUserId, orderId);
      const blobName: string | undefined = row.imageBlob;
      if (!blobName) return { status: 404, body: "not found" };

      const block = blob.getContainerClient("qrcodes").getBlockBlobClient(blobName);

      // 中身
      const buf = await block.downloadToBuffer();

      // Content-Type は BLOB のプロパティから取得（なければ拡張子で推定）
      const props = await block.getProperties();
      let ct = props.contentType || "application/octet-stream";
      const lower = blobName.toLowerCase();
      if (!props.contentType) {
        if (lower.endsWith(".png")) ct = "image/png";
        else if (/\.(jpe?g)$/.test(lower)) ct = "image/jpeg";
      }

      return {
        status: 200,
        body: buf,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "no-store"
        }
      };
    } catch {
      return { status: 404, body: "not found" };
    }
  }
});

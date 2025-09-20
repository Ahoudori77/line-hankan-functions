import { app, HttpRequest } from "@azure/functions";
import { validateSignature, Client, WebhookEvent } from "@line/bot-sdk";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { TableClient } from "@azure/data-tables";

const secret = process.env.LINE_CHANNEL_SECRET!;
const client = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

// ストレージ接続
const conn = process.env.AzureWebJobsStorage!;
const table = TableClient.fromConnectionString(conn, "Orders");
const blob = BlobServiceClient.fromConnectionString(conn);

// Azurite かどうかを接続文字列から判定
const usingAzurite = /UseDevelopmentStorage=true/i.test(conn) ||
                      /AccountName=devstoreaccount1/i.test(conn);

// 実ストレージ用: BLOB の SAS URLを生成
function buildBlobSasUrl(containerName: string, blobName: string): string | null {
  try {
    const mName = /AccountName=([^;]+)/i.exec(conn);
    const mKey  = /AccountKey=([^;]+)/i.exec(conn);
    if (!mName || !mKey) return null;

    const cred = new StorageSharedKeyCredential(mName[1], mKey[1]);
    const sas = generateBlobSASQueryParameters({
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      // 時計ズレ対策で少し過去から
      startsOn: new Date(Date.now() - 2 * 60 * 1000),
      expiresOn: new Date(Date.now() + 15 * 60 * 1000),
      protocol: SASProtocol.Https, // LINEはHTTPSのみ
    }, cred).toString();

    const base = blob.getContainerClient(containerName).getBlobClient(blobName).url;
    return `${base}?${sas}`;
  } catch (e: any) {
    console.log("[webhook] buildBlobSasUrl error:", e?.message);
    return null;
  }
}

async function ensureInit() {
  try { await table.createTable(); } catch {}
  await blob.getContainerClient("qrcodes").createIfNotExists();
}

app.http("line-webhook", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => {
    const raw = await req.text();
    const sig = req.headers.get("x-line-signature") ?? "";
    if (!validateSignature(raw, secret, sig)) {
      return { status: 401, body: "invalid signature" };
    }

    await ensureInit();

    const events: WebhookEvent[] = JSON.parse(raw).events ?? [];
    for (const ev of events) {
      const userId =
        ev.source.type === "user" ? ev.source.userId :
        ev.source.type === "group" ? ev.source.groupId :
        ev.source.type === "room" ? ev.source.roomId : undefined;

      console.log("[LINE EVENT]", ev.type, { userId });

      if (ev.type === "follow" && ev.replyToken) {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text:
            "友だち追加ありがとう！\n" +
            "使い方:\n" +
            "・id → userId を表示\n" +
            "・qr <注文ID> → 登録済みQRを表示\n" +
            "・status <注文ID> → ステータス表示"
        });
        continue;
      }

      if (ev.type === "message" && ev.replyToken && ev.message?.type === "text") {
        // 1:1 以外では userId が取れない
        if (ev.source.type !== "user" || !userId) {
          await client.replyMessage(ev.replyToken, { type: "text", text: "このコマンドは1:1トークで使ってね。" });
          continue;
        }

        const textRaw = ev.message.text.trim();
        const text = textRaw.toLowerCase();

        // id
        if (text === "id" || text === "uid") {
          await client.replyMessage(ev.replyToken, { type: "text", text: `userId: ${userId}` });
          continue;
        }

        // qr <orderId>
        if (text.startsWith("qr ")) {
          const orderId = textRaw.split(/\s+/)[1];
          if (!orderId) {
            await client.replyMessage(ev.replyToken, { type: "text", text: "使い方: qr <注文ID>" });
            continue;
          }
          try {
            const row = await table.getEntity<any>(userId, orderId); // PK = userId, RK = orderId
            const blobName: string | undefined = row.imageBlob;
            if (!blobName) {
              await client.replyMessage(ev.replyToken, { type: "text", text: `注文 ${orderId} のQRはまだ登録されていません。` });
              continue;
            }

            if (!usingAzurite) {
              const url = buildBlobSasUrl("qrcodes", blobName);
              console.log("[webhook] QR SAS URL:", url);
              if (url) {
                await client.replyMessage(ev.replyToken, {
                  type: "image",
                  originalContentUrl: url,
                  previewImageUrl: url,
                });
              } else {
                await client.replyMessage(ev.replyToken, {
                  type: "text",
                  text: `画像URLの生成に失敗しました。注文: ${orderId}`,
                });
              }
            } else {
              // Azurite のときはテキスト案内のまま
              await client.replyMessage(ev.replyToken, {
                type: "text",
                text: `QR登録済みです（開発環境）。orderId=${orderId}\nblob=${blobName}`
              });
            }
          } catch (e: any) {
            console.log("[webhook] qr error:", e?.message);
            await client.replyMessage(ev.replyToken, { type: "text", text: `注文 ${orderId} は見つかりません。` });
          }
          continue;
        }

        // status <orderId>
        if (text.startsWith("status ")) {
          const orderId = textRaw.split(/\s+/)[1];
          if (!orderId) {
            await client.replyMessage(ev.replyToken, { type: "text", text: "使い方: status <注文ID>" });
            continue;
          }
          try {
            const row = await table.getEntity<any>(userId, orderId);
            const status = row.status ?? "unknown";
            await client.replyMessage(ev.replyToken, { type: "text", text: `注文 ${orderId} のステータス: ${status}` });
          } catch {
            await client.replyMessage(ev.replyToken, { type: "text", text: `注文 ${orderId} は見つかりません。` });
          }
          continue;
        }

        // それ以外
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "受け取りました！\n（help: id / qr <注文ID> / status <注文ID>）"
        });
      }
    }

    return { status: 200, body: "ok" };
  }
});

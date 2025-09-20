import { app, HttpRequest } from "@azure/functions";
import { Client } from "@line/bot-sdk";

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!
});

app.http("notify-send", {
  methods: ["POST"],
  authLevel: "anonymous", // 開発中は手動ガード。将来 "function" 化予定
  handler: async (req: HttpRequest) => {
    const key = req.headers.get("x-functions-key") ?? new URL(req.url).searchParams.get("code");
    if (!key || key !== process.env.NOTIFY_SEND_KEY) {
      return { status: 401, jsonBody: { error: "unauthorized" } };
    }

    let body: any;
    try { body = await req.json(); } catch { /* noop */ }
    const to = body?.to;
    const text: string | undefined = body?.text;
    const imageUrl: string | undefined = body?.imageUrl;

    if (!to || (!text && !imageUrl)) {
      return { status: 400, jsonBody: { error: "to と text または imageUrl が必要です" } };
    }

    try {
      if (imageUrl) {
        // Azurite(HTTP) だとLINEが取得できないため、開発ではテキストにフォールバック
        if (/^https:\/\//i.test(imageUrl)) {
          await client.pushMessage(to, {
            type: "image",
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl
          });
        } else {
          await client.pushMessage(to, { type: "text", text: `画像を登録しました: ${imageUrl}` });
        }
      }
      if (text) {
        await client.pushMessage(to, { type: "text", text });
      }
      return { jsonBody: { ok: true } };
    } catch (e: any) {
      console.error("[notify-send] push error", e?.statusCode, e?.originalError ?? e);
      return { status: 500, jsonBody: { error: "push failed" } };
    }
  }
});

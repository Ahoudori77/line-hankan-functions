import { app, HttpRequest } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { Client } from "@line/bot-sdk";

const conn = process.env.AzureWebJobsStorage!;
const users = TableClient.fromConnectionString(conn, "Users");
const line = new Client({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });

type Role = "seller" | "manager" | "all";
interface BroadcastBody {
  toRole?: Role;
  toIds?: string[];
  text?: string;
  imageUrl?: string;
}

app.http("admin-broadcast", {
  methods: ["POST"],
  authLevel: "function",
  route: "ops/broadcast",
  handler: async (req: HttpRequest) => {
    const body = (await req.json().catch(() => ({}))) as BroadcastBody;
    const { toRole, toIds, text, imageUrl } = body;

    if (!text && !imageUrl) {
      return { status: 400, jsonBody: { error: "text または imageUrl が必要" } };
    }

    await users.createTable().catch(() => {});

    let targets: string[] = [];
    if (Array.isArray(toIds) && toIds.length > 0) {
      targets = toIds;
    } else if (toRole && toRole !== "all") {
      const iter = users.listEntities<any>({
        queryOptions: { filter: `PartitionKey eq '${toRole}' and isActive eq true` },
      });
      for await (const u of iter) targets.push(String(u.rowKey));
    } else {
      const envTo = process.env.ADMIN_BROADCAST_TO ?? "";
      targets = envTo.split(",").map(s => s.trim()).filter(Boolean);
    }

    if (!targets.length) {
      return { status: 404, jsonBody: { error: "送信先が見つかりません" } };
    }

    let count = 0;
    for (const to of targets) {
      try {
        if (imageUrl) {
          await line.pushMessage(to, {
            type: "image",
            originalContentUrl: imageUrl,
            previewImageUrl: imageUrl,
          });
        }
        if (text) {
          await line.pushMessage(to, { type: "text", text });
        }
        count++;
      } catch (e: any) {
        console.error("[admin-broadcast] push error", to, e?.statusCode, e?.originalError ?? e);
      }
    }

    return { jsonBody: { ok: true, count, targets } };
  },
});

import { app } from "@azure/functions";

app.http("ping", {
  route: "ping",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({ status: 200, body: "pong" })
});

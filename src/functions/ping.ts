import { app } from "@azure/functions";

app.http("ping", {
  route: "ping",
  methods: ["GET"],
  authLevel: "Anonymous",
  handler: async () => ({ status: 200, body: "pong" })
});

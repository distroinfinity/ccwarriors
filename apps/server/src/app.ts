import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

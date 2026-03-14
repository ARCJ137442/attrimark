import { Hono } from "hono";
import { cors } from "hono/cors";
import { api } from "./api";

const app = new Hono();

app.use("/*", cors());
app.route("/api", api);

const port = parseInt(process.env.PORT ?? "12479");

console.log(`Attrimark API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

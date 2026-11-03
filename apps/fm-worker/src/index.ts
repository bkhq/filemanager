import { Hono } from "hono";
import { r2Driver } from "@/fm/drivers/r2";
import { createFmRouter } from "@/fm/server/router";

interface Env {
  Bindings: {
    FM_BUCKET: R2Bucket;
    ASSETS: Fetcher;
  };
}

const app = new Hono<Env>();

app.route("/api/fm", createFmRouter<Env>({
  mounts: c => [
    {
      id: "r2",
      label: "R2 bucket",
      driver: r2Driver({ bucket: c.env.FM_BUCKET }),
      trash: true,
    },
  ],
}));

app.onError((err, c) => {
  console.error(err);
  return c.json({
    error: { code: "INTERNAL", message: "Internal error" },
  }, 500);
});

// Requests the API does not handle fall through to the static assets.
app.all("*", c => c.env.ASSETS.fetch(c.req.raw));

export default app;

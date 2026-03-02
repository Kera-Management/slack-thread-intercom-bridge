import { serve } from "@hono/node-server";
import { logger } from "./config/logger.js";
import { createProductionApp } from "./runtime.js";

const port = Number(process.env.PORT ?? "3000");
const app = createProductionApp();

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info(
      {
        port: info.port,
        localUrl: `http://localhost:${info.port}`,
      },
      "Server listening",
    );
  },
);

import { serve } from "@hono/node-server";
import { createProductionApp } from "./runtime.js";

const port = Number(process.env.PORT ?? "3000");
const app = createProductionApp();

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${info.port}`);
  },
);

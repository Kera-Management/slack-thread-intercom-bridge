import { createProductionApp } from "../src/runtime.js";

const app = createProductionApp();

export default app.fetch;

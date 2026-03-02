import { Hono } from "hono";
import { createProductionApp } from "./runtime.js";

void Hono;

const app = createProductionApp();

export default app;

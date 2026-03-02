import type { Context } from "hono";

export function getHeader(c: Context, name: string): string | null {
  const headers = (c.req.raw as { headers?: unknown } | undefined)?.headers as
    | Headers
    | Record<string, unknown>
    | undefined;

  if (!headers) {
    return null;
  }

  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }

  const normalizedName = name.toLowerCase();
  const rawValue =
    (headers as Record<string, unknown>)[normalizedName] ??
    (headers as Record<string, unknown>)[name];

  if (Array.isArray(rawValue)) {
    return rawValue.length > 0 ? String(rawValue[0]) : null;
  }

  if (typeof rawValue === "string") {
    return rawValue;
  }

  return null;
}

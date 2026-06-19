import crypto from "node:crypto";

/** Short, unguessable token for QR codes (not derived from the SKU code). */
export function genToken(prefix = "SQR"): string {
  return `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

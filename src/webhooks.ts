import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "./types.js";

/** The request header that carries a delivery's timestamp and signatures. */
export const WEBHOOK_SIGNATURE_HEADER = "GBE-Signature";

/** Why a webhook request failed verification. */
export type WebhookVerificationReason = "malformed_header" | "timestamp_out_of_tolerance" | "no_matching_signature" | "invalid_payload";

/** The request did not come from the engine (or was replayed, or tampered with). Answer 400. */
export class WebhookVerificationError extends Error {
  readonly reason: WebhookVerificationReason;
  constructor(reason: WebhookVerificationReason, message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

export interface VerifyWebhookOptions {
  /** Maximum age of the signature's timestamp, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** The current time in Unix seconds (for tests). */
  now?: number;
}

/**
 * Checks a webhook delivery and returns its event.
 *
 * Pass the **raw** request body (before any JSON parsing), the GBE-Signature
 * header and your endpoint secret. Pass several secrets while you roll a new
 * one out. Throws WebhookVerificationError if the signature does not match or
 * the timestamp is older than the tolerance.
 *
 *     app.post("/gbe/webhooks", express.raw({ type: "application/json" }), (req, res) => {
 *       const event = verifyWebhook(req.body, req.get("GBE-Signature"), process.env.GBE_WEBHOOK_SECRET!);
 *       if (event.type === "account.debited") notifyPlayer(event.data);
 *       res.sendStatus(204);
 *     });
 */
export function verifyWebhook(
  payload: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string | readonly string[],
  options: VerifyWebhookOptions = {},
): WebhookEvent {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  let t = 0;
  const signatures: Buffer[] = [];
  for (const part of (signatureHeader ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1" && /^[0-9a-f]+$/i.test(v)) signatures.push(Buffer.from(v, "hex"));
  }
  if (!Number.isInteger(t) || t <= 0 || signatures.length === 0) {
    throw new WebhookVerificationError("malformed_header", `missing or malformed ${WEBHOOK_SIGNATURE_HEADER} header`);
  }
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tolerance) {
    throw new WebhookVerificationError("timestamp_out_of_tolerance", `the signature's timestamp is more than ${tolerance}s from now`);
  }
  const secrets = typeof secret === "string" ? [secret] : secret;
  const matched = secrets.some((s) => {
    const want = createHmac("sha256", s).update(`${t}.`).update(body).digest();
    return signatures.some((sig) => sig.length === want.length && timingSafeEqual(sig, want));
  });
  if (!matched) throw new WebhookVerificationError("no_matching_signature", "no signature matches the secret");
  try {
    return JSON.parse(body.toString("utf8")) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("invalid_payload", "the body is not JSON");
  }
}

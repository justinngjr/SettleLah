import "server-only";

import QRCode from "qrcode";

import { buildPayNowPayload, formatSGD } from "@/domain";
import type { PaymentRequest } from "@/server/db/payments";

import type { HostProfile } from "./db";

export interface PayNowQr {
  readonly png: Buffer;
  readonly caption: string;
}

export function hostDisplayName(host: HostProfile): string {
  return host.paynowDisplayName?.trim() || host.displayName?.trim() || "your host";
}

export function hostHasPayNow(host: HostProfile): boolean {
  return host.paynowProxyType !== null && !!host.paynowProxyValue;
}

export function payNowCaption(host: HostProfile, request: PaymentRequest): string {
  return `${formatSGD(request.amount)} · Ref ${request.reference}\nPay ${hostDisplayName(host)} via PayNow`;
}

/** PNG of the PayNow QR for one request; `null` when the host has no PayNow proxy configured. */
export async function renderPayNowQr(host: HostProfile, request: PaymentRequest): Promise<PayNowQr | null> {
  if (host.paynowProxyType === null || !host.paynowProxyValue) return null;
  const payload = buildPayNowPayload({
    proxyType: host.paynowProxyType,
    proxyValue: host.paynowProxyValue,
    amount: request.amount,
    reference: request.reference,
    payeeName: hostDisplayName(host),
  });
  const png = await QRCode.toBuffer(payload, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 8 });
  return { png, caption: payNowCaption(host, request) };
}

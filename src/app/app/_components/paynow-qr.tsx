import QRCode from "qrcode";

import { buildPayNowPayload, PayNowError, type PayNowProxyType } from "@/domain";

export interface PayNowQrProps {
  readonly proxyType: PayNowProxyType;
  readonly proxyValue: string;
  readonly payeeName: string;
  readonly amount: number;
  readonly reference: string;
  readonly friendName: string;
}

/** Server component: renders the dynamic PayNow QR for one open request as an SVG. */
export async function PayNowQr(props: PayNowQrProps) {
  let payload: string;
  try {
    payload = buildPayNowPayload({
      proxyType: props.proxyType,
      proxyValue: props.proxyValue,
      payeeName: props.payeeName,
      amount: props.amount,
      reference: props.reference,
    });
  } catch (error) {
    if (error instanceof PayNowError) {
      return (
        <p role="alert" className="text-ink-soft">
          The QR could not be generated: {error.message}. Check your PayNow details in Settings.
        </p>
      );
    }
    throw error;
  }
  const svg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return (
    <figure className="space-y-4">
      <div
        role="img"
        aria-label={`PayNow QR code for ${props.friendName}, reference ${props.reference}`}
        className="w-full max-w-64 rounded-lg border border-line bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="label">Scan with any Singapore bank app</figcaption>
    </figure>
  );
}

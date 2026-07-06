import "server-only";
import QRCode from "qrcode";

// We encode the secure token directly (not the SKU code). Any reader resolves it
// to a SKU only via the backend, satisfying the "secure identifier" requirement.
// margin 2 = a proper quiet zone; errorCorrectionLevel M balances redundancy vs
// keeping the modules big enough to survive thermal printing / camera capture.
export async function qrSvg(token: string, size = 200): Promise<string> {
  return QRCode.toString(token, { type: "svg", margin: 2, width: size, errorCorrectionLevel: "M" });
}

export async function qrDataUrl(token: string, size = 320): Promise<string> {
  return QRCode.toDataURL(token, { margin: 2, width: size, errorCorrectionLevel: "M" });
}

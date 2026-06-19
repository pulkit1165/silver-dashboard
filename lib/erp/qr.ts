import "server-only";
import QRCode from "qrcode";

// We encode the secure token directly (not the SKU code). Any reader resolves it
// to a SKU only via the backend, satisfying the "secure identifier" requirement.
export async function qrSvg(token: string, size = 160): Promise<string> {
  return QRCode.toString(token, { type: "svg", margin: 1, width: size });
}

export async function qrDataUrl(token: string, size = 240): Promise<string> {
  return QRCode.toDataURL(token, { margin: 1, width: size });
}

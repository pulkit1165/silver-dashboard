import "server-only";
import QRCode from "qrcode";

// We encode the secure token directly (not the SKU code). Any reader resolves it
// to a SKU only via the backend, satisfying the "secure identifier" requirement.
// margin 4 = the FULL QR-spec quiet zone (4 modules). It was 2, which is half-spec
// and made cheap 2D scanners intermittently miss labels printed hard against ink or
// read at an angle. errorCorrectionLevel M balances redundancy vs module size.
// shape-rendering=crispEdges keeps modules hard-edged when the browser rescales the
// SVG to a non-integer pixel size (no grey anti-aliased module borders → cleaner print).
export async function qrSvg(token: string, size = 200): Promise<string> {
  const svg = await QRCode.toString(token, { type: "svg", margin: 4, width: size, errorCorrectionLevel: "M" });
  return svg.replace("<svg ", '<svg shape-rendering="crispEdges" ');
}

export async function qrDataUrl(token: string, size = 320): Promise<string> {
  return QRCode.toDataURL(token, { margin: 4, width: size, errorCorrectionLevel: "M" });
}

// The raw QR module matrix (no quiet zone) so the label renderer can draw uniform,
// integer-dot modules with its own baked-in quiet zone — the ONLY way a printed QR
// scans reliably on cheap hardware scanners (scaling an image gives uneven modules).
export function qrMatrix(token: string): { size: number; data: number[] } {
  const qr = QRCode.create(token, { errorCorrectionLevel: "M" });
  const data = qr.modules.data as unknown as ArrayLike<number>;
  return { size: qr.modules.size, data: Array.from(data, (b) => (b ? 1 : 0)) };
}

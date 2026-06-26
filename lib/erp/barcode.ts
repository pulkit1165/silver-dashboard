import "server-only";
import bwipjs from "bwip-js/node";

// 1D Code128 barcode for printed labels — encodes the SKU's own item code
// (distinct from the secure qr_token used by the warehouse scan workflow).
export function barcodeSvg(code: string, height = 12): string {
  return bwipjs.toSVG({
    bcid: "code128",
    text: code,
    scale: 2,
    height,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
}

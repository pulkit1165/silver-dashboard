// Sizes for the ABBREVIATION-sticker module. Same physical stocks as the normal
// labels, but under a distinct `sticker-<id>` design key so the sticker designs live
// as separate rows in label_designs and never collide with the current QR-label
// designs (base or `__long`). The Sticker Designer + print page use these ids.
import { LABEL_SIZES, type LabelSize } from "./labelSizes";

export const STICKER_PREFIX = "sticker-";
export const stickerSizeId = (baseId: string): string =>
  baseId.startsWith(STICKER_PREFIX) ? baseId : STICKER_PREFIX + baseId;
export const isStickerSizeId = (id?: string | null): boolean => !!id && id.startsWith(STICKER_PREFIX);

export const STICKER_SIZES: LabelSize[] = LABEL_SIZES.map((s) => ({
  id: stickerSizeId(s.id), label: s.label, w: s.w, h: s.h,
}));

export const stickerSizeById = (id?: string | null): LabelSize | undefined =>
  STICKER_SIZES.find((s) => s.id === id);

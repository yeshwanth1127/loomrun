/**
 * Design workspace garment defaults — mirrors apps/api/.../garment_defaults.py
 * and maps onto existing TEMPLATE_2D catalog keys.
 */

export type ProductType =
  | 'T_SHIRT'
  | 'POLO_T_SHIRT'
  | 'SHIRT'
  | 'PANTS'
  | 'SHORTS'
  | 'HOODIE'
  | 'SWEATSHIRT'
  | 'JACKET'
  | 'OTHER'

export const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: 'T_SHIRT', label: 'T-Shirt' },
  { value: 'POLO_T_SHIRT', label: 'Polo T-Shirt' },
  { value: 'SHIRT', label: 'Shirt' },
  { value: 'PANTS', label: 'Pants / Trousers' },
  { value: 'SHORTS', label: 'Shorts' },
  { value: 'HOODIE', label: 'Hoodie' },
  { value: 'SWEATSHIRT', label: 'Sweatshirt' },
  { value: 'JACKET', label: 'Jacket' },
  { value: 'OTHER', label: 'Other' },
]

/** Catalog garment_type for TEMPLATE_2D templates. */
export const CATALOG_GARMENT: Record<ProductType, string> = {
  T_SHIRT: 'TSHIRT',
  POLO_T_SHIRT: 'POLO',
  SHIRT: 'SHIRT',
  PANTS: 'PANT',
  SHORTS: 'SHORTS',
  HOODIE: 'HOODIE',
  SWEATSHIRT: 'HOODIE',
  JACKET: 'HOODIE',
  OTHER: 'TSHIRT',
}

export const DEFAULT_GARMENT_VIEWS = ['FRONT', 'BACK', 'LEFT', 'RIGHT'] as const
export type GarmentView = (typeof DEFAULT_GARMENT_VIEWS)[number]

export const COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: 'White', hex: '#FFFFFF' },
  { label: 'Black', hex: '#1A1A1A' },
  { label: 'Navy', hex: '#1E3A5F' },
  { label: 'Grey', hex: '#8B929A' },
  { label: 'Red', hex: '#C62828' },
  { label: 'Blue', hex: '#1565C0' },
  { label: 'Green', hex: '#2E7D32' },
  { label: 'Yellow', hex: '#F9A825' },
  { label: 'Beige', hex: '#D7C4A5' },
]

const DETECT: [RegExp, ProductType][] = [
  [/\bpolo\b/i, 'POLO_T_SHIRT'],
  [/\bhoodie\b|\bhoody\b/i, 'HOODIE'],
  [/\bsweat\s*shirt\b|\bsweatshirt\b/i, 'SWEATSHIRT'],
  [/\bjacket\b|\bblazer\b/i, 'JACKET'],
  [/\bshorts?\b/i, 'SHORTS'],
  [/\bpants?\b|\btrousers?\b|\bdenim\b|\bjeans?\b/i, 'PANTS'],
  [/\bt[\s-]?shirts?\b|\btee\b/i, 'T_SHIRT'],
  [/\bshirts?\b/i, 'SHIRT'],
]

export function resolveProductTypeFromText(...parts: Array<string | null | undefined>): ProductType | null {
  const blob = parts.filter(Boolean).join(' ').trim()
  if (!blob) return null
  for (const [re, type] of DETECT) {
    if (re.test(blob)) return type
  }
  return null
}

export function templateKeyFor(productType: ProductType, view: GarmentView): string {
  const g = CATALOG_GARMENT[productType]
  const map: Record<string, Record<GarmentView, string>> = {
    TSHIRT: { FRONT: 'tshirt_front', BACK: 'tshirt_back', LEFT: 'tshirt_left', RIGHT: 'tshirt_right' },
    POLO: { FRONT: 'polo_front', BACK: 'polo_back', LEFT: 'polo_left', RIGHT: 'polo_right' },
    SHIRT: { FRONT: 'shirt_front', BACK: 'shirt_back', LEFT: 'shirt_left', RIGHT: 'shirt_right' },
    HOODIE: { FRONT: 'hoodie_front', BACK: 'hoodie_back', LEFT: 'hoodie_left', RIGHT: 'hoodie_right' },
    PANT: { FRONT: 'pant_front', BACK: 'pant_back', LEFT: 'pant_left', RIGHT: 'pant_right' },
    SHORTS: { FRONT: 'shorts_front', BACK: 'shorts_back', LEFT: 'shorts_left', RIGHT: 'shorts_right' },
  }
  return map[g]?.[view] ?? map.TSHIRT[view]
}

export function normalizeHex(raw: string | null | undefined, fallback = '#FFFFFF'): string {
  if (!raw) return fallback
  let c = raw.trim()
  if (!c.startsWith('#')) c = `#${c}`
  if (!/^#[0-9A-Fa-f]{6}$/.test(c)) return fallback
  return c.toUpperCase()
}

export function presetLabel(hex: string): string | null {
  const n = normalizeHex(hex)
  return COLOR_PRESETS.find((p) => p.hex.toUpperCase() === n)?.label ?? null
}

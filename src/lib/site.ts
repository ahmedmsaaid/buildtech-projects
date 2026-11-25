/**
 * What the platform's own home page shows, as set by the owner in the
 * dashboard (a separate project that writes these same tables): its words,
 * color and picture, its banners, and the plans on offer.
 */
import { query } from './db';
import { isHexColor } from './validate';

export interface SiteSettings {
  /** The brand color of the home page. */
  accent: string;
  heroTitle: string;
  /** The part of the headline written in the brand color. */
  heroHighlight: string;
  heroLead: string;
  /** A picture beside the headline; null shows none. */
  heroImageId: string | null;
  showPlans: boolean;
}

/** What the page says until the owner changes it. The dashboard keeps the same list. */
export const defaultSettings: SiteSettings = {
  accent: '#19c37d',
  heroTitle: 'نظام كامل لشغلك،',
  heroHighlight: 'جاهز من النهارده',
  heroLead: 'مش هتستنى شهور بناء. بتختار النظام اللي يناسب نشاطك، بنجهّزه باسمك وألوانك، وتبدأ تشتغل عليه.',
  heroImageId: null,
  showPlans: true,
};

/** The saved settings over the defaults. Anything missing or malformed falls back to its default. */
export async function getSiteSettings(): Promise<SiteSettings> {
  const [row] = await query<{ content: Partial<Record<keyof SiteSettings, unknown>> | string }>('select content from site_settings where id = 1');
  // The local development database hands JSON back as text.
  const saved = typeof row?.content === 'string' ? (JSON.parse(row.content) as Partial<Record<keyof SiteSettings, unknown>>) : (row?.content ?? {});
  const words = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback);

  return {
    accent: typeof saved.accent === 'string' && isHexColor(saved.accent) ? saved.accent : defaultSettings.accent,
    heroTitle: words(saved.heroTitle, defaultSettings.heroTitle),
    // The highlight may be left empty on purpose.
    heroHighlight: typeof saved.heroHighlight === 'string' ? saved.heroHighlight : defaultSettings.heroHighlight,
    heroLead: words(saved.heroLead, defaultSettings.heroLead),
    heroImageId: typeof saved.heroImageId === 'string' && saved.heroImageId ? saved.heroImageId : null,
    showPlans: typeof saved.showPlans === 'boolean' ? saved.showPlans : defaultSettings.showPlans,
  };
}

/** Black or white, whichever reads better as text on the given color. */
export function readableOn(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.35 ? '#101314' : '#ffffff';
}

export interface Banner {
  id: string;
  title: string;
  body: string;
  link_url: string;
  link_label: string;
  image_id: string | null;
}

/** The banners switched on, in the owner's order. */
export function getBanners(): Promise<Banner[]> {
  return query<Banner>('select id, title, body, link_url, link_label, image_id from site_banners where is_active order by sort_order, created_at');
}

export interface PublicPlan {
  product: string;
  name: string;
  months: number;
  price: number;
}

/** The plans on offer, by product. */
export async function getPlansByProduct(): Promise<Map<string, PublicPlan[]>> {
  const plans = await query<PublicPlan>('select product, name, months, price from plans where is_active order by product, sort_order, months');
  const byProduct = new Map<string, PublicPlan[]>();
  for (const plan of plans) byProduct.set(plan.product, [...(byProduct.get(plan.product) ?? []), plan]);
  return byProduct;
}

/** "شهرياً", "كل 3 شهور", "سنوياً": how often a plan is paid. */
export function periodLabel(months: number): string {
  if (months === 1) return 'شهرياً';
  if (months === 12) return 'سنوياً';
  if (months === 2) return 'كل شهرين';
  return months <= 10 ? `كل ${months} شهور` : `كل ${months} شهر`;
}

export interface StoredImage {
  mime: string;
  bytes: Uint8Array;
}

/** A picture the owner uploaded, or null. */
export async function getImage(id: string): Promise<StoredImage | null> {
  const [row] = await query<{ mime: string; data: string }>(`select mime, encode(data, 'base64') as data from site_images where id = $1`, [id]);
  return row ? { mime: row.mime, bytes: Buffer.from(row.data, 'base64') } : null;
}

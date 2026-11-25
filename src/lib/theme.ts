/**
 * A clinic's look. Each choice is one of a fixed list, stored as JSON on the
 * clinic and written onto <body> as data attributes; the stylesheet does the
 * rest (see "Themes" in app.css). Nothing a clinic types reaches the page as
 * CSS: only the listed values and a checked hex color are ever used.
 */
import { updateAppearance, type Account } from './accounts';
import { isHexColor } from './validate';

export const themeChoices = {
  mode: ['light', 'dark'],
  background: ['neutral', 'tinted', 'warm', 'white'],
  corners: ['sharp', 'soft', 'round'],
  cards: ['shadow', 'outline', 'flat'],
  hero: ['gradient', 'solid', 'soft'],
  buttons: ['filled', 'soft', 'outline'],
  font: ['plex', 'cairo', 'tajawal', 'almarai'],
  density: ['comfortable', 'compact'],
} as const;

export type ThemeKey = keyof typeof themeChoices;
export type ThemeOptions = { [Key in ThemeKey]: (typeof themeChoices)[Key][number] };
export type Theme = ThemeOptions & { accent: string };

export const defaultOptions: ThemeOptions = {
  mode: 'light',
  background: 'neutral',
  corners: 'soft',
  cards: 'shadow',
  hero: 'gradient',
  buttons: 'filled',
  font: 'plex',
  density: 'comfortable',
};

export const DEFAULT_ACCENT = '#0f766e';

/** What staff read on the appearance page. */
export const themeLabels: { [Key in ThemeKey]: { title: string; choices: Record<ThemeOptions[Key], string> } } = {
  mode: { title: 'الوضع', choices: { light: 'فاتح', dark: 'ليلي' } },
  background: { title: 'الخلفية', choices: { neutral: 'رمادي هادي', tinted: 'من لون العيادة', warm: 'دافي', white: 'أبيض' } },
  corners: { title: 'الزوايا', choices: { sharp: 'حادة', soft: 'ناعمة', round: 'دائرية' } },
  cards: { title: 'الكروت', choices: { shadow: 'بظل', outline: 'بإطار', flat: 'مسطّحة' } },
  hero: { title: 'رأس الصفحة', choices: { gradient: 'تدرّج', solid: 'لون واحد', soft: 'فاتح' } },
  buttons: { title: 'الأزرار', choices: { filled: 'ممتلئة', soft: 'فاتحة', outline: 'بإطار' } },
  font: { title: 'الخط', choices: { plex: 'IBM Plex', cairo: 'Cairo', tajawal: 'Tajawal', almarai: 'Almarai' } },
  density: { title: 'المسافات', choices: { comfortable: 'واسعة', compact: 'مضغوطة' } },
};

const fontStacks: Record<ThemeOptions['font'], string> = {
  plex: "'IBM Plex Sans Arabic'",
  cairo: "'Cairo'",
  tajawal: "'Tajawal'",
  almarai: "'Almarai'",
};

export interface Preset {
  key: string;
  name: string;
  theme: Theme;
}

/** Complete looks a clinic can take in one tap, then adjust. */
export const presets: Preset[] = [
  { key: 'default', name: 'الأساسي', theme: { ...defaultOptions, accent: DEFAULT_ACCENT } },
  { key: 'night', name: 'ليلي', theme: { ...defaultOptions, accent: '#0d9488', mode: 'dark', cards: 'outline' } },
  { key: 'rose', name: 'وردي ناعم', theme: { ...defaultOptions, accent: '#be185d', background: 'tinted', corners: 'round', hero: 'soft', font: 'tajawal' } },
  { key: 'classic', name: 'أزرق كلاسيك', theme: { ...defaultOptions, accent: '#1d4ed8', background: 'white', corners: 'sharp', cards: 'outline', hero: 'solid', font: 'cairo' } },
  { key: 'warm', name: 'دافي', theme: { ...defaultOptions, accent: '#b45309', background: 'warm', cards: 'flat', font: 'almarai' } },
  { key: 'violet', name: 'بنفسجي عصري', theme: { ...defaultOptions, accent: '#6d28d9', background: 'tinted', corners: 'round', buttons: 'soft', font: 'cairo' } },
];

function isChoice<Key extends ThemeKey>(key: Key, value: unknown): value is ThemeOptions[Key] {
  return (themeChoices[key] as readonly unknown[]).includes(value);
}

/** Keeps only known choices from untrusted input (a form, or stored JSON); anything else falls back to the default. */
export function cleanOptions(input: Record<string, unknown>): ThemeOptions {
  const options: Record<string, string> = { ...defaultOptions };
  for (const key of Object.keys(themeChoices) as ThemeKey[]) {
    if (isChoice(key, input[key])) options[key] = input[key];
  }
  return options as ThemeOptions;
}

/** The look of a clinic, from what is stored on it. */
export function themeOf(clinic: Pick<Account, 'accent' | 'theme'>): Theme {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(clinic.theme || '{}');
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // A damaged value just means the default look.
  }
  return { ...cleanOptions(stored), accent: isHexColor(clinic.accent) ? clinic.accent : DEFAULT_ACCENT };
}

/** The <body> attribute each choice is written to. The font is a CSS variable instead. */
export const attributeByChoice: Record<Exclude<ThemeKey, 'font'>, string> = {
  mode: 'data-mode',
  background: 'data-bg',
  corners: 'data-corners',
  cards: 'data-cards',
  hero: 'data-hero',
  buttons: 'data-buttons',
  density: 'data-density',
};

/** The attributes that put a theme on <body>. */
export function bodyAttributes(theme: Theme): Record<string, string> {
  const attributes: Record<string, string> = { style: `--accent: ${theme.accent}; --font: ${fontStacks[theme.font]}` };
  for (const [choice, attribute] of Object.entries(attributeByChoice)) attributes[attribute] = theme[choice as ThemeKey];
  return attributes;
}

/** The same mapping for the browser, used by the live preview. */
export const fontStackByChoice = fontStacks;

/**
 * Saves what the appearance editor sent: either a ready-made look, or a
 * color with individual choices. Returns a message when the color is not valid.
 */
export async function saveAppearance(accountId: string, form: FormData): Promise<string | null> {
  const preset = presets.find((candidate) => candidate.key === form.get('preset'));
  if (preset) {
    const { accent, ...options } = preset.theme;
    await updateAppearance(accountId, accent, options);
    return null;
  }

  const accent = String(form.get('accent') ?? '').slice(0, 7);
  if (!isHexColor(accent)) return 'اختار لون صحيح.';

  // Only the listed choices are kept; anything else in the form is ignored.
  await updateAppearance(accountId, accent, cleanOptions(Object.fromEntries(form)));
  return null;
}

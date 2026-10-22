import type { AccentId, AppearanceSettings, ThemeId } from '../shared/types.ts';

export const THEME_META: Record<ThemeId, { name: string; sub: string }> = {
  ink: { name: '墨夜', sub: '深夜书房' },
  abyss: { name: '雾蓝', sub: '港口夜航' },
  moss: { name: '苔青', sub: '山中清晨' },
  paper: { name: '宣纸', sub: '白日书房' },
};

export const ACCENT_PRESETS: Record<AccentId, {
  name: string; dark: string; hi: string; deep: string; light: string; lightHi: string; lightDeep: string;
}> = {
  cinnabar: { name: '朱砂', dark: '#d4634c', hi: '#e47a61', deep: '#b8563f', light: '#b8503a', lightHi: '#a84632', lightDeep: '#963c2c' },
  jade: { name: '青玉', dark: '#6fb3a4', hi: '#8acbbd', deep: '#4c8a7e', light: '#2f7f70', lightHi: '#276b5f', lightDeep: '#215a50' },
  amber: { name: '琥珀', dark: '#c8a96b', hi: '#dcc28c', deep: '#9b7e45', light: '#8a6a2f', lightHi: '#755925', lightDeep: '#624a1f' },
  indigo: { name: '靛蓝', dark: '#6f8fd0', hi: '#8da9e3', deep: '#4e6ba8', light: '#4767a8', lightHi: '#3a568e', lightDeep: '#304874' },
  violet: { name: '紫藤', dark: '#a88bc9', hi: '#c0a6dd', deep: '#7e649e', light: '#73569a', lightHi: '#604681', lightDeep: '#50396c' },
  graphite: { name: '墨灰', dark: '#8b8f99', hi: '#a6aab3', deep: '#666a73', light: '#5f636c', lightHi: '#4d5159', lightDeep: '#3f434a' },
};

function hexToRgb(hex: string) {
  const clean = String(hex || '').replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 212, g: 99, b: 76 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mixHex(hex: string, target: string, amount: number) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const t = Math.max(0, Math.min(1, amount));
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(a.r + (b.r - a.r) * t)}${toHex(a.g + (b.g - a.g) * t)}${toHex(a.b + (b.b - a.b) * t)}`;
}

export function resolveAccent(appearance: AppearanceSettings) {
  const isPaper = appearance.theme === 'paper';
  if (appearance.customAccent) {
    const base = isPaper ? mixHex(appearance.customAccent, '#3a2418', 0.18) : appearance.customAccent;
    return {
      name: '自定义',
      base,
      hi: isPaper ? mixHex(base, '#000000', 0.1) : mixHex(base, '#ffffff', 0.16),
      deep: mixHex(base, '#000000', isPaper ? 0.2 : 0.16),
      rgb: hexToRgb(base),
    };
  }
  const preset = ACCENT_PRESETS[appearance.accent] || ACCENT_PRESETS.cinnabar;
  return {
    name: preset.name,
    base: isPaper ? preset.light : preset.dark,
    hi: isPaper ? preset.lightHi : preset.hi,
    deep: isPaper ? preset.lightDeep : preset.deep,
    rgb: hexToRgb(isPaper ? preset.light : preset.dark),
  };
}

export function applyAppearance(appearance: AppearanceSettings) {
  const theme = THEME_META[appearance.theme] ? appearance.theme : 'ink';
  const accent = resolveAccent({ ...appearance, theme });
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.setProperty('--accent', accent.base);
  root.style.setProperty('--accent-hi', accent.hi);
  root.style.setProperty('--accent-deep', accent.deep);
  root.style.setProperty('--accent-rgb', `${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}`);
  root.style.setProperty('--accent-soft', `rgba(${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}, ${theme === 'paper' ? 0.09 : 0.11})`);
  root.style.setProperty('--accent-line', `rgba(${accent.rgb.r}, ${accent.rgb.g}, ${accent.rgb.b}, ${theme === 'paper' ? 0.26 : 0.3})`);
  root.style.setProperty('--editor-size', `${appearance.editorSize}px`);
  root.classList.toggle('reduce-motion', Boolean(appearance.reduceMotion));
  try {
    localStorage.setItem('pw.appearance.latest', JSON.stringify(appearance));
  } catch {
    // ignore
  }
}

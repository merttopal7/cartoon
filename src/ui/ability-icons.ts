import { resolveAbility } from '../engine/ability-registry';

export interface AbilityIconDrawCmd {
  d: string;
  fill?: boolean;
  stroke?: boolean;
  strokeWidth?: number;
}

export interface AbilityIconMeta {
  /** Kanonik yetenek kimliği */
  id: string;
  /** Ekranda gösterilecek Türkçe yetenek adı */
  title: string;
  /** Yeteneği kullanan varsayılan karakter adı */
  characterName: string;
  /** Kenarları radiuslu kare arkaplanın tek (solid) rengi */
  bgColor: string;
  /** Aktif vurgu çerçeve rengi */
  accentColor: string;
  /** Karenin tam ortasında yer alacak 24x24 SVG ikonu */
  svg: string;
  /** Canvas 2D (Path2D) üzerinde aynı SVG ikonunu çizmek için vektör komutları */
  paths: AbilityIconDrawCmd[];
}

export const CANONICAL_ABILITY_ICONS: Record<string, AbilityIconMeta> = {
  ates_topu: {
    id: 'ates_topu',
    title: 'Ateş Topu',
    characterName: 'Toprak',
    bgColor: '#E65100',
    accentColor: '#FFB74D',
    svg: `<svg class="ability-svg-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C13.8 5.2 17.5 7.5 18.5 11.8C19.3 15.4 16.6 20.2 12 21.5C7.4 20.2 4.7 15.4 5.5 11.8C6.1 9.1 7.8 7.4 9.2 6.2C8.8 8.2 9.8 9.8 11.2 10.4C10.4 7.6 10.8 4.4 12 2Z" fill="#FFFFFF" fill-opacity="0.22" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12 11.2C13.9 12.6 14.8 14.5 14.4 16.5C14.1 18.1 13.1 19.2 12 19.6C10.9 19.2 9.9 18.1 9.6 16.5C9.2 14.5 10.1 12.6 12 11.2Z" fill="#FFFFFF"/>
    </svg>`,
    paths: [
      {
        d: 'M12 2C13.8 5.2 17.5 7.5 18.5 11.8C19.3 15.4 16.6 20.2 12 21.5C7.4 20.2 4.7 15.4 5.5 11.8C6.1 9.1 7.8 7.4 9.2 6.2C8.8 8.2 9.8 9.8 11.2 10.4C10.4 7.6 10.8 4.4 12 2Z',
        stroke: true,
        strokeWidth: 2,
      },
      {
        d: 'M12 11.2C13.9 12.6 14.8 14.5 14.4 16.5C14.1 18.1 13.1 19.2 12 19.6C10.9 19.2 9.9 18.1 9.6 16.5C9.2 14.5 10.1 12.6 12 11.2Z',
        fill: true,
      },
    ],
  },

  ruzgar_hortumu: {
    id: 'ruzgar_hortumu',
    title: 'Rüzgar Hortumu',
    characterName: 'Defne',
    bgColor: '#0D9488',
    accentColor: '#5EEAD4',
    svg: `<svg class="ability-svg-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 5.5H21" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M5.5 9.8H19.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M7.5 14.1H17" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M9.5 18.2H14.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="11.5" cy="21" r="1.3" fill="#FFFFFF"/>
    </svg>`,
    paths: [
      { d: 'M3 5.5H21M5.5 9.8H19.5M7.5 14.1H17M9.5 18.2H14.5', stroke: true, strokeWidth: 2.2 },
      { d: 'M10.2 21A1.3 1.3 0 1 0 12.8 21A1.3 1.3 0 1 0 10.2 21Z', fill: true },
    ],
  },

  firtina_oku: {
    id: 'firtina_oku',
    title: 'Fırtına Oku',
    characterName: 'Meşe',
    bgColor: '#1D4ED8',
    accentColor: '#93C5FD',
    svg: `<svg class="ability-svg-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4.5C12.5 5.2 16.8 9.5 17.5 16" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M4.5 18L11.5 11L9.5 9.5L19 3.5L14 11.5L16 13L4.5 18Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>`,
    paths: [
      { d: 'M6 4.5C12.5 5.2 16.8 9.5 17.5 16', stroke: true, strokeWidth: 2.2 },
      { d: 'M4.5 18L11.5 11L9.5 9.5L19 3.5L14 11.5L16 13L4.5 18Z', fill: true, stroke: true, strokeWidth: 1.4 },
    ],
  },

  karanlik_buyu: {
    id: 'karanlik_buyu',
    title: 'Karanlık Büyü',
    characterName: 'Karabey',
    bgColor: '#3B0764',
    accentColor: '#D8B4FE',
    svg: `<svg class="ability-svg-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C7.5 3 4 6.5 4 11C4 14.6 6.4 17.6 9.7 18.6C8.8 16.8 9.2 14.6 10.8 13.4C12.4 12.2 14.6 12.5 15.8 14C17.2 15.7 16.8 18.2 15 19.6C18.1 18.4 20 15.2 20 11.5C20 6.8 16.4 3 12 3Z" fill="#FFFFFF" fill-opacity="0.22" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="10" r="2.3" fill="#FFFFFF"/>
      <path d="M7 21C8.5 19.5 10.2 19.5 12 21C13.8 19.5 15.5 19.5 17 21" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    paths: [
      {
        d: 'M12 3C7.5 3 4 6.5 4 11C4 14.6 6.4 17.6 9.7 18.6C8.8 16.8 9.2 14.6 10.8 13.4C12.4 12.2 14.6 12.5 15.8 14C17.2 15.7 16.8 18.2 15 19.6C18.1 18.4 20 15.2 20 11.5C20 6.8 16.4 3 12 3Z',
        stroke: true,
        strokeWidth: 2,
      },
      { d: 'M9.7 10A2.3 2.3 0 1 0 14.3 10A2.3 2.3 0 1 0 9.7 10Z', fill: true },
      { d: 'M7 21C8.5 19.5 10.2 19.5 12 21C13.8 19.5 15.5 19.5 17 21', stroke: true, strokeWidth: 2 },
    ],
  },

  agac_devirme: {
    id: 'agac_devirme',
    title: 'Ağaç Devirme',
    characterName: 'Karabey',
    bgColor: '#7C2D12',
    accentColor: '#FDBA74',
    svg: `<svg class="ability-svg-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15.5 2.5L20.5 8.8H17.2L21 13.5H9.2L12.8 8.8H9.8L15.5 2.5Z" fill="#FFFFFF" fill-opacity="0.25" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.2 13.5L12.2 15.8" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M4.5 17.2L17.5 14.8" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M7.5 21.5L8.8 18.2H12.8L14 21.5H7.5Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`,
    paths: [
      {
        d: 'M15.5 2.5L20.5 8.8H17.2L21 13.5H9.2L12.8 8.8H9.8L15.5 2.5Z',
        stroke: true,
        strokeWidth: 2,
      },
      { d: 'M13.2 13.5L12.2 15.8M4.5 17.2L17.5 14.8', stroke: true, strokeWidth: 2.2 },
      { d: 'M7.5 21.5L8.8 18.2H12.8L14 21.5H7.5Z', fill: true, stroke: true, strokeWidth: 1.6 },
    ],
  },
};

/** Yetenek adı veya takma adından HUD ikonu; eşleme src/data/abilities.yaml'deki `icon` alanından (yoksa yeteneğin kendi adı). */
export function getAbilityIconMeta(name: string): AbilityIconMeta {
  const def = resolveAbility(name);
  const key = def?.icon ?? def?.id ?? 'ates_topu';
  return CANONICAL_ABILITY_ICONS[key] ?? CANONICAL_ABILITY_ICONS.ates_topu;
}

export function formatCharacterDisplayName(id: string): string {
  const map: Record<string, string> = {
    toprak: 'Toprak',
    defne: 'Defne',
    mese: 'Meşe (Erika)',
    erika: 'Erika',
    karabey: 'Karabey',
  };
  return map[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

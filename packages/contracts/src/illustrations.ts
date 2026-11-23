import { z } from 'zod';
import type { Locale } from '@sabaq/lesson/types';

export const illustrationDescriptions = {
  'water-lab': {
    en: 'Glass measuring cylinders with different amounts of water stand on an outdoor work table.',
    ru: 'На столе во дворе стоят мерные цилиндры с разным количеством воды.',
    kk: 'Ауладағы үстел үстінде су мөлшері әртүрлі өлшеуіш цилиндрлер тұр.',
  },
  'kindness-notebooks': {
    en: 'In a school corridor, one pupil helps another pick up notebooks from the floor.',
    ru: 'В школьном коридоре один ученик помогает другому собрать тетради с пола.',
    kk: 'Мектеп дәлізінде бір оқушы екіншісіне еденге шашылған дәптерлерді жинауға көмектесіп жатыр.',
  },
  'kindness-schoolyard': {
    en: 'In a schoolyard a girl turns towards a boy sitting apart on a bench.',
    ru: 'В школьном дворе девочка поворачивается к мальчику, который сидит отдельно на скамейке.',
    kk: 'Мектеп ауласында қыз орындықта бөлек отырған балаға бұрылып қарайды.',
  },
  'seedling-growth': {
    en: 'A young bean plant has two pale seed leaves low on its stem and a pair of green, veined leaves above.',
    ru: 'У молодого ростка фасоли две светлые семядоли внизу стебля и два зелёных листа с прожилками выше.',
    kk: 'Жас үрмебұршақтың сабағының төменгі жағында екі ашық түсті тұқымжарнақ, жоғары жағында жүйкелері көрінетін екі жасыл жапырақ бар.',
  },
} satisfies Record<string, Record<Locale, string>>;
type AssetId = keyof typeof illustrationDescriptions;
const assetIds = Object.keys(illustrationDescriptions) as [AssetId, ...AssetId[]];
export function catalogDescription(src: string, language: Locale) {
  const name = /^\/assets\/([a-z-]+)\.webp$/.exec(src)?.[1];
  return name && Object.hasOwn(illustrationDescriptions, name) ? illustrationDescriptions[name as AssetId][language] : undefined;
}
export const illustrationCatalog = assetIds.map((id) => ({ id, description: illustrationDescriptions[id].en }));
export const imageSettingSchema = z.object({
  place: z.string().trim().min(1).max(160).optional(),
  period: z.string().trim().min(1).max(160).optional(),
});
export const imageRequestSchema = z
  .object({
    ...imageSettingSchema.shape,
    asset: z.enum(assetIds).optional(),
    prompt: z.string().trim().min(1).max(1600).optional(),
    alt: z.string().trim().min(1).max(400).optional(),
  })
  .strict();
export type ImageRequest = z.infer<typeof imageRequestSchema>;

import { useId } from 'react';
import type { AvatarPlacement } from '@sabaq/contracts/video';
import type { Locale } from '@sabaq/lesson/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';

export const avatarVideoCopy = {
  en: {
    title: 'Avatar', withAvatar: 'With avatar', narration: 'Narration only', area: 'Avatar area',
    position: 'Avatar position', left: 'Left', right: 'Right', placement: 'Avatar placement',
    corner: 'Corner', half: 'Half frame', clear: 'Without background',
    unavailable: 'Check your avatar and consent status to use it.',
  },
  ru: {
    title: 'Аватар', withAvatar: 'С аватаром', narration: 'Только озвучка', area: 'Область аватара',
    position: 'Сторона кадра', left: 'Слева', right: 'Справа', placement: 'Размещение аватара',
    corner: 'В углу', half: 'Половина кадра', clear: 'Без фона',
    unavailable: 'Проверьте статус аватара и согласия, чтобы использовать его.',
  },
  kk: {
    title: 'Аватар', withAvatar: 'Аватармен', narration: 'Тек дыбыстау', area: 'Аватар аймағы',
    position: 'Кадр жағы', left: 'Сол жақта', right: 'Оң жақта', placement: 'Аватардың орналасуы',
    corner: 'Бұрышта', half: 'Кадрдың жартысы', clear: 'Фонсыз',
    unavailable: 'Аватарды пайдалану үшін оның күйін және келісімді тексеріңіз.',
  },
};

const sides = ['left', 'right'] as const;
const placements = ['corner', 'half', 'clear'] as const;
export type AvatarSide = typeof sides[number];

export function LectureAvatarOptions({ locale, available, selected, side, placement, onSelected, onSide, onPlacement }: {
  locale: Locale;
  available: boolean;
  selected: boolean;
  side: AvatarSide;
  placement: AvatarPlacement;
  onSelected: (selected: boolean) => void;
  onSide: (side: AvatarSide) => void;
  onPlacement: (placement: AvatarPlacement) => void;
}) {
  const copy = avatarVideoCopy[locale];
  const help = useId();
  return <div className="lecture-avatar-options">
    <div className="lecture-format-field">
      <span>{copy.title}</span>
      <ToggleGroup aria-label={copy.title} aria-describedby={available ? undefined : help} className="lecture-formats lecture-two-choices"
        value={[selected ? 'avatar' : 'narration']} onValueChange={values => {
          if (values[0]) onSelected(values[0] === 'avatar');
        }}>
        <ToggleGroupItem value="narration">{copy.narration}</ToggleGroupItem>
        <ToggleGroupItem value="avatar" disabled={!available}>{copy.withAvatar}</ToggleGroupItem>
      </ToggleGroup>
      {!available && <small id={help} className="lecture-avatar-help">{copy.unavailable}</small>}
    </div>
    {selected && available && <>
      <div className="lecture-format-field">
        <span>{copy.position}</span>
        <ToggleGroup aria-label={copy.position} className="lecture-formats lecture-two-choices" value={[side]}
          onValueChange={values => { if (values[0]) onSide(values[0] as AvatarSide); }}>
          {sides.map(value => <ToggleGroupItem key={value} value={value}>{copy[value]}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="lecture-format-field">
        <span>{copy.placement}</span>
        <ToggleGroup aria-label={copy.placement} className="lecture-formats" value={[placement]}
          onValueChange={values => { if (values[0]) onPlacement(values[0] as AvatarPlacement); }}>
          {placements.map(value => <ToggleGroupItem key={value} value={value}>{copy[value]}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
    </>}
  </div>;
}

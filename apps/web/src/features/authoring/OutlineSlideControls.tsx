import { useRef } from 'react';
import {
  ArrowDownIcon, ArrowUpIcon, ArrowsMergeIcon, ArrowsSplitIcon, DotsThreeIcon,
  TextAlignLeftIcon, TextOutdentIcon, TrashIcon, type Icon,
} from '@phosphor-icons/react';
import { splitSummary } from '@sabaq/lesson/outline-edits';
import { maxLessonSlides, type Locale, type OutlineItem } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/shadcn/dropdown-menu';
import { words } from '@/copy';
import './outline-slide-controls.css';

const commandCopy = {
  en: {
    actions: 'Slide actions', slide: 'Slide', order: 'Order', text: 'Text', structure: 'Structure',
    shorten: 'Shorten summary', expand: 'Add detail', split: 'Split slide', merge: 'Merge with next',
    detail: 'Ask students to explain their reasoning using an example.',
  },
  ru: {
    actions: 'Действия со слайдом', slide: 'Слайд', order: 'Порядок', text: 'Текст', structure: 'Структура',
    shorten: 'Сократить описание', expand: 'Добавить детали', split: 'Разделить слайд', merge: 'Объединить со следующим',
    detail: 'Попросите учеников пояснить ответ на примере.',
  },
  kk: {
    actions: 'Слайд әрекеттері', slide: 'Слайд', order: 'Реті', text: 'Мәтін', structure: 'Құрылым',
    shorten: 'Сипаттаманы қысқарту', expand: 'Толықтыру', split: 'Слайдты бөлу', merge: 'Келесімен біріктіру',
    detail: 'Оқушылардан жауапты мысал арқылы түсіндіруді сұраңыз.',
  },
};

function ActionItem({ icon: Glyph, label, disabled, destructive, onClick }: {
  icon: Icon; label: string; disabled?: boolean; destructive?: boolean; onClick: () => void;
}) {
  return <DropdownMenuItem disabled={disabled} variant={destructive ? 'destructive' : 'default'} onClick={onClick}>
    <Glyph aria-hidden="true"/><span className="outline-option-text">{label}</span>
  </DropdownMenuItem>;
}

export function OutlineActionsMenu({ locale, language, items, index, disabled, onChange }: {
  locale: Locale; language: Locale; items: OutlineItem[]; index: number; disabled: boolean; onChange: (outline: OutlineItem[]) => void;
}) {
  const copy = commandCopy[locale];
  const labels = words[locale];
  const detail = commandCopy[language].detail;
  const item = items[index];
  const next = items[index + 1];
  const [short, rest] = splitSummary(item.summary, language);
  const slideNumber = index + 1;
  const actionLabel = copy.actions + ' ' + slideNumber;
  const focusAfterRemoval = useRef<HTMLElement | null>(null);

  function move(offset: number) {
    const reordered = [...items];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], item];
    onChange(reordered);
  }
  function replace(removeCount: number, ...replacement: OutlineItem[]) {
    onChange([...items.slice(0, index), ...replacement, ...items.slice(index + removeCount)]);
  }

  function remove() {
    const neighbor = next ?? items[index - 1];
    if (!neighbor) return;
    focusAfterRemoval.current = document.getElementById('outline-actions-' + neighbor.id);
    replace(1);
  }

  return <DropdownMenu>
    <DropdownMenuTrigger id={'outline-actions-' + item.id} disabled={disabled} render={<Button variant="ghost" size="icon-sm" className="outline-actions-trigger" aria-label={actionLabel}/>}>
      <DotsThreeIcon weight="bold" aria-hidden="true"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="outline-actions-popup" align="end" sideOffset={6} aria-label={actionLabel} finalFocus={() => focusAfterRemoval.current ?? true}>
      <div className="outline-action-caption" aria-hidden="true">{copy.slide}<span>{String(slideNumber).padStart(2, '0')}</span></div>
      <DropdownMenuGroup aria-label={copy.order}>
        <ActionItem icon={ArrowUpIcon} label={labels.moveUp} disabled={index === 0} onClick={() => move(-1)}/>
        <ActionItem icon={ArrowDownIcon} label={labels.moveDown} disabled={!next} onClick={() => move(1)}/>
      </DropdownMenuGroup>
      <DropdownMenuSeparator/>
      <DropdownMenuGroup aria-label={copy.text}>
        <ActionItem icon={TextOutdentIcon} label={copy.shorten} disabled={!rest} onClick={() => replace(1, { ...item, summary: short })}/>
        <ActionItem icon={TextAlignLeftIcon} label={copy.expand} disabled={item.summary.includes(detail) || item.summary.length + detail.length + 1 > 600}
          onClick={() => replace(1, { ...item, summary: (item.summary + ' ' + detail).trim() })}/>
      </DropdownMenuGroup>
      <DropdownMenuSeparator/>
      <DropdownMenuGroup aria-label={copy.structure}>
        <ActionItem icon={ArrowsSplitIcon} label={copy.split} disabled={items.length >= maxLessonSlides || !rest} onClick={() =>
          replace(1, { ...item, summary: short }, { ...item, id: crypto.randomUUID(), title: rest.slice(0, 85), summary: rest })}/>
        <ActionItem icon={ArrowsMergeIcon} label={copy.merge} disabled={!next || item.summary.length + 1 + (next?.summary.length ?? 0) > 600}
          onClick={() => { if (next) replace(2, { ...item, summary: item.summary + ' ' + next.summary }); }}/>
      </DropdownMenuGroup>
      <DropdownMenuSeparator/>
      <DropdownMenuGroup>
        <ActionItem icon={TrashIcon} label={labels.remove} destructive disabled={items.length <= 1} onClick={remove}/>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

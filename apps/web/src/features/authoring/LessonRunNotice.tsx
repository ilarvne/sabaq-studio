import { useCallback, useRef, useState } from 'react';
import { CheckCircleIcon, WifiSlashIcon, XIcon } from '@phosphor-icons/react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { Button, buttonVariants } from '@/components/shadcn/button';
import { words } from '@/copy';
import { useAuthoringProgress } from './DeckWorkbench';
import './lesson-run-notice.css';

const statusCopy = {
  en: { offline:'Offline. Some actions require a connection.', ready:'Lesson ready', open:'Open lesson', dismiss:'Dismiss completion notice' },
  ru: { offline:'Нет сети. Для некоторых действий нужно подключение.', ready:'Урок готов', open:'Открыть урок', dismiss:'Закрыть уведомление о готовности' },
  kk: { offline:'Желі жоқ. Кейбір әрекеттер үшін қосылым қажет.', ready:'Сабақ дайын', open:'Сабақты ашу', dismiss:'Дайындық хабарламасын жабу' },
};

export const lessonIsGenerating = (deck: Deck) =>
  deck.phase === 'generating' || deck.outlineStatus === 'generating';

type ReadyLesson = Pick<Deck, 'id' | 'title' | 'language'>;

export function useLessonRunNotice() {
  const [notice, setNotice] = useState<ReadyLesson>();
  const runs = useRef(new Map<string, {revision: number; running: boolean}>());
  const observe = useCallback((deck: Deck) => {
    const previous = runs.current.get(deck.id);
    const running = lessonIsGenerating(deck);
    if ((!previous && !running) || (previous && previous.revision >= deck.revision)) return;
    runs.current.set(deck.id, {revision: deck.revision, running});
    if (previous?.running && deck.phase === 'editing' && deck.slides.length && deck.slides.every(slide => slide.status === 'ready')) {
      setNotice({ id:deck.id, title:deck.title, language:deck.language });
    }
  }, []);
  return { notice, observe, dismiss:() => setNotice(undefined) };
}

export function BackgroundLessonRun({ deck, onUpdate }: {deck: Deck; onUpdate: (deck: Deck) => void}) {
  useAuthoringProgress(deck, onUpdate);
  return null;
}

export function LessonRunNotice({ online, notice, locale, currentLesson, onDismiss }: {
  online: boolean; notice?: ReadyLesson; locale: Locale; currentLesson?: string; onDismiss: () => void;
}) {
  const c = statusCopy[locale];
  return <div className="studio-status" data-visible={!online || Boolean(notice)}>
    <div className="studio-status-messages" role="status" aria-atomic="false">
      {!online && <p><WifiSlashIcon aria-hidden="true"/>{c.offline}</p>}
      {notice && <p><CheckCircleIcon className="studio-status-ready" aria-hidden="true"/>
        <span><strong>{c.ready}</strong>{' · '}<span lang={notice.language}>{notice.title}</span></span>
      </p>}
    </div>
    {notice && <div className="studio-status-actions">
      {notice.id !== currentLesson && <a className={buttonVariants({ size:'sm', variant:'ghost' })}
        href={`#/deck/${encodeURIComponent(notice.id)}`} onClick={onDismiss}>{c.open}</a>}
      <Button size="icon-sm" variant="ghost" aria-label={c.dismiss} title={words[locale].close} onClick={onDismiss}>
        <XIcon aria-hidden="true"/>
      </Button>
    </div>}
  </div>;
}

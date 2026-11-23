import type { ReactNode } from 'react';
import type { Locale } from '@sabaq/lesson/types';
import { DeckNavigation } from '@/components/DeckNavigation';
import './collaboration-header.css';

const modes = {
  en: { view: 'Read-only view', edit: 'Shared editing' },
  kk: { view: 'Тек қарау', edit: 'Бірлесіп өңдеу' },
  ru: { view: 'Только просмотр', edit: 'Совместное редактирование' },
};

export function CollaborationHeader({ locale, title, language, mode, action }: {
  locale: Locale;
  title: string;
  language: Locale;
  mode: 'view' | 'edit';
  action?: ReactNode;
}) {
  return (
    <header className="collaboration-header">
      <DeckNavigation locale={locale}/>
      <div className="collaboration-title">
        <h1 lang={language} title={title}>{title}</h1>
        <span>{modes[locale][mode]}</span>
      </div>
      {action}
    </header>
  );
}

import { CheckIcon, GlobeSimpleIcon, PencilSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import type { AssistantActivity } from '@sabaq/contracts/assistant';
import type { Locale } from '@sabaq/lesson/types';
import { ThinkingIndicator } from '@/components/assistant-ui/elements/thinking-indicator';

const copy = {
  en: { thinking: 'Thinking…', ready: 'Response ready.' },
  ru: { thinking: 'Думаю…', ready: 'Ответ готов.' },
  kk: { thinking: 'Ойланып жатыр…', ready: 'Жауап дайын.' },
};

export function workingLabel(locale: Locale) {
  return copy[locale].thinking;
}

export function responseReadyLabel(locale: Locale) {
  return copy[locale].ready;
}

export function AssistantWorking({locale}: {locale:Locale}) {
  return <ThinkingIndicator className="as-thinking" aria-hidden="true" label={workingLabel(locale)}/>;
}

const toolCopy = {
  en: {
    web_search: ['Searching the web…', 'Web search'],
    web_research: ['Researching the web…', 'Deep research'],
    write_web_answer: ['Writing from sources…', 'Sourced answer'],
    failed: 'Failed', cancelled: 'Stopped', sources: 'Sources found',
  },
  ru: {
    web_search: ['Ищу в интернете…', 'Веб-поиск'],
    web_research: ['Изучаю открытые источники…', 'Исследование'],
    write_web_answer: ['Пишу ответ по источникам…', 'Ответ по источникам'],
    failed: 'Ошибка', cancelled: 'Остановлено', sources: 'Найдено источников',
  },
  kk: {
    web_search: ['Интернеттен іздеп жатырмын…', 'Веб іздеу'],
    web_research: ['Ашық дереккөздерді зерттеп жатырмын…', 'Терең зерттеу'],
    write_web_answer: ['Дереккөздер бойынша жауап жазып жатырмын…', 'Дереккөздерге сүйенген жауап'],
    failed: 'Қате', cancelled: 'Тоқтатылды', sources: 'Табылған дереккөздер',
  },
};

export function isWebActivity(kind: AssistantActivity['kind']): kind is 'web_search' | 'web_research' | 'write_web_answer' {
  return kind === 'web_search' || kind === 'web_research' || kind === 'write_web_answer';
}

export function assistantToolLabel(activity: AssistantActivity, locale: Locale) {
  if (!isWebActivity(activity.kind)) return undefined;
  return toolCopy[locale][activity.kind][activity.status === 'running' ? 0 : 1];
}

export function AssistantToolStatus({activity, locale}: {activity: AssistantActivity; locale: Locale}) {
  const {kind, status, count} = activity;
  if (!isWebActivity(kind)) return null;
  const t = toolCopy[locale];
  const writing = kind === 'write_web_answer';
  const Icon = status === 'complete' ? CheckIcon
    : status === 'error' ? WarningCircleIcon : status === 'cancelled' ? XIcon
    : writing ? PencilSimpleIcon : GlobeSimpleIcon;
  return <div className="as-tool-step" data-state={status}>
    <Icon aria-hidden/>
    <span>{assistantToolLabel(activity, locale)}</span>
    <span className="as-tool-provider">{writing ? 'AlemLLM' : 'Exa'}</span>
    {status === 'complete' && count !== undefined && <span className="as-tool-count">
      <span className="sr-only">{t.sources} </span>{count}
    </span>}
    {status === 'error' && <span className="as-tool-outcome">{t.failed}</span>}
    {status === 'cancelled' && <span className="as-tool-outcome">{t.cancelled}</span>}
  </div>;
}

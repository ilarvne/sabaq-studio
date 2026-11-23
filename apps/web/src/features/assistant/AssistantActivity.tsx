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

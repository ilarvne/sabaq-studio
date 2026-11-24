import { ArrowUpRightIcon, CaretDownIcon, GlobeSimpleIcon } from '@phosphor-icons/react';
import type { AssistantMessage, AssistantWebSource } from '@sabaq/contracts/assistant';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { ReasoningEffort } from '@/components/assistant-ui/elements/reasoning-effort';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/shadcn/collapsible';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/shadcn/popover';
import { Switch } from '@/components/shadcn/switch';
import { cn } from '@/lib/utils';
import './assistant-research.css';

export type WebResearchMode = NonNullable<AssistantMessage['webResearch']>;

export const researchCopy = {
  en: {
    tools: 'Web tools', web: 'Web', toggle: 'Search the web', depth: 'Research depth', search: 'Web search', research: 'Deep research',
    searchHint: 'Find relevant public sources.', researchHint: 'Compare evidence across sources.',
    disclosure: 'Exa searches your public question. AlemLLM writes the answer.', authoringDisclosure: 'Exa searches the public topic. AlemLLM writes the lesson.',
    unavailable: 'Exa is unavailable in this workspace.',
    modelUnavailable: 'Web research for lessons requires AlemLLM.',
    conflicting: 'Clear files, library search, or the selected-text request to use web tools.',
    authoringConflict: 'Use a topic without attached files or pasted notes to search the web.',
    searchPlaceholder: 'What should I look up?', researchPlaceholder: 'What should I research?',
    sources: 'Web sources',
  },
  ru: {
    tools: 'Веб-инструменты', web: 'Веб', toggle: 'Искать в интернете', depth: 'Глубина исследования', search: 'Веб-поиск', research: 'Исследование',
    searchHint: 'Найти открытые источники.', researchHint: 'Сопоставить данные из разных источников.',
    disclosure: 'Exa ищет источники по вашему запросу. AlemLLM пишет ответ.', authoringDisclosure: 'Exa ищет по открытой теме. AlemLLM пишет урок.',
    unavailable: 'Exa недоступна в этом рабочем пространстве.',
    modelUnavailable: 'Для создания урока с веб-исследованием нужен AlemLLM.',
    conflicting: 'Чтобы искать в интернете, уберите файлы, отключите поиск по библиотеке или завершите запрос по выделенному тексту.',
    authoringConflict: 'Для веб-поиска введите тему без вложений и вставленного конспекта.',
    searchPlaceholder: 'Что найти в интернете?', researchPlaceholder: 'Что нужно исследовать?',
    sources: 'Веб-источники',
  },
  kk: {
    tools: 'Веб құралдары', web: 'Веб', toggle: 'Интернеттен іздеу', depth: 'Зерттеу тереңдігі', search: 'Веб іздеу', research: 'Терең зерттеу',
    searchHint: 'Ашық дереккөздерді табу.', researchHint: 'Әртүрлі дереккөздердің мәліметтерін салыстыру.',
    disclosure: 'Exa ашық сұрағыңыз бойынша іздейді. AlemLLM жауап жазады.', authoringDisclosure: 'Exa ашық тақырып бойынша іздейді. AlemLLM сабақ мәтінін жазады.',
    unavailable: 'Бұл жұмыс кеңістігінде Exa қолжетімсіз.',
    modelUnavailable: 'Веб-зерттеумен сабақ жасау үшін AlemLLM қажет.',
    conflicting: 'Веб құралдарын қолдану үшін файлдарды алып тастаңыз, кітапханадан іздеуді өшіріңіз немесе таңдалған мәтін бойынша сұрауды аяқтаңыз.',
    authoringConflict: 'Интернеттен іздеу үшін тіркеме мен жазбасыз тақырып енгізіңіз.',
    searchPlaceholder: 'Интернеттен не іздеу керек?', researchPlaceholder: 'Нені зерттеу керек?',
    sources: 'Веб дереккөздер',
  },
};

export function isWebResearchMode(value: unknown): value is WebResearchMode {
  return value === 'search' || value === 'research';
}

function webSourceLinks(sources: AssistantWebSource[]) {
  return sources.flatMap((source, index) => {
    try {
      const url = new URL(source.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return [];
      return [{...source, number:index + 1, url:url.href, host:url.hostname.replace(/^www\./, '')}];
    } catch {
      return [];
    }
  });
}

export function linkResearchCitations(text: string, sources: AssistantWebSource[]) {
  const definitions = webSourceLinks(sources)
    .filter(source => text.includes(`[${source.number}]`))
    .map(source => `[${source.number}]: <${source.url}>`);
  return definitions.length ? `${text}\n\n${definitions.join('\n')}` : text;
}

export function exportWebResearch(text: string, sources: AssistantWebSource[], locale: Locale) {
  const references = webSourceLinks(sources)
    .map(({number,title,url}) => `${number}. [${title.replace(/[\\\[\]]/g, '\\$&')}](<${url}>)`);
  const markdown = references.length ? `${text}\n\n## ${researchCopy[locale].sources}\n\n${references.join('\n')}\n` : text;
  const url = URL.createObjectURL(new Blob([markdown], {type:'text/markdown;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sabaq-research.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export function AssistantResearchMenu({locale, mode, available, modelAvailable = true, conflicting = false, disabled, surface = 'assistant', className, onModeChange}: {
  locale: Locale;
  mode?: WebResearchMode;
  available: boolean;
  modelAvailable?: boolean;
  conflicting?: boolean;
  disabled: boolean;
  surface?: 'assistant' | 'authoring';
  className?: string;
  onModeChange: (value?: WebResearchMode) => void;
}) {
  const t = researchCopy[locale];
  const blocked = !available || !modelAvailable || conflicting;
  const status = !available ? t.unavailable
    : !modelAvailable ? t.modelUnavailable
    : conflicting ? surface === 'authoring' ? t.authoringConflict : t.conflicting
    : surface === 'authoring' ? t.authoringDisclosure : t.disclosure;
  return <Popover>
    <PopoverTrigger render={<Button variant={mode ? 'secondary' : 'ghost'} size="xs" className={cn('as-research-trigger',className)} />} disabled={disabled}
      aria-label={mode ? `${t.tools} · ${t[mode]}` : t.tools} title={t.tools}>
      <GlobeSimpleIcon aria-hidden data-icon="inline-start"/>
      <span>{mode ? t[mode] : t.web}</span>
      <CaretDownIcon aria-hidden data-icon="inline-end"/>
    </PopoverTrigger>
    <PopoverContent className="as-research-menu" align="start" side="top" sideOffset={8}>
      <PopoverTitle className="sr-only">{t.tools}</PopoverTitle>
      <div className="as-web-toggle">
        <span>{t.toggle}</span>
        <Switch checked={Boolean(mode)} disabled={disabled || blocked && !mode}
          aria-label={t.toggle} onCheckedChange={checked => onModeChange(checked ? 'search' : undefined)}/>
      </div>
      <ReasoningEffort label={t.depth} levels={[{key:'search',label:t.search},{key:'research',label:t.research}]}
        selectedKey={mode} disabled={disabled || blocked || !mode}
        onSelect={value => { if (isWebResearchMode(value)) onModeChange(value); }}/>
      {mode && !blocked && <p className="as-depth-hint">{mode === 'search' ? t.searchHint : t.researchHint}</p>}
      <p className="as-research-disclosure">{status}</p>
    </PopoverContent>
  </Popover>;
}

export function AssistantWebSources({locale, sources}: {
  locale: Locale;
  sources: AssistantWebSource[];
}) {
  const links = webSourceLinks(sources);
  if (!links.length) return null;
  const t = researchCopy[locale];
  return <Collapsible className="as-web-sources">
    <CollapsibleTrigger render={<Button size="xs" variant="ghost" className="as-web-sources-trigger"/>}>
      <CaretDownIcon aria-hidden data-icon="inline-start"/>
      {t.sources} ({links.length})
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ol className="as-web-source-list">
        {links.map(source => <li key={source.id} value={source.number}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            <span>{source.title}</span><ArrowUpRightIcon aria-hidden/>
            <small>{source.host}</small>
          </a>
          {source.excerpt && <blockquote>{source.excerpt}</blockquote>}
        </li>)}
      </ol>
    </CollapsibleContent>
  </Collapsible>;
}

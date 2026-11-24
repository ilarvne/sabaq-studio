import { CaretDownIcon, ImagesSquareIcon, SlidersHorizontalIcon, StackIcon, GlobeHemisphereWestIcon, CpuIcon, MagnifyingGlassIcon, ListNumbersIcon, PathIcon, ListChecksIcon, LightningIcon } from '@phosphor-icons/react';
import { imageModes, maxLessonSlides, minGeneratedSlides, type WebResearchMode, type ImageMode, type Locale, type Provider } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/shadcn/dropdown-menu';
import { Input } from '@/components/shadcn/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/shadcn/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';
import { LanguageFlag } from '@/components/LanguageFlag';
import { languages, words } from '@/copy';
import { ImageLayoutSample } from './ImageLayoutSample';

const copy = {
  en: {
    images: 'Images', auto: 'Auto', exact: 'Exact', plan: 'Plan', immediate: 'Direct', settings: 'Generation options',
    count: 'Slide count', exactCount: 'Exact slide count', language: 'Presentation language', provider: 'Text generation',
    research: 'Public sources', noResearch: 'Off', usingSource: 'Using your material',
    local: 'Local AI', start: 'Creation flow', review: 'Review the outline', direct: 'Generate directly',
    range: (min: number, max: number) => `Choose a whole number from ${min} to ${max}.`,
    modes: {
      auto: ['Automatic', 'Choose visuals that fit your topic.'],
      illustrated: ['Illustrated slides', 'Place illustrations alongside editable text.'],
      'image-led': ['Image-led slides', 'Give images more space and keep the text editable.'],
      none: ['No images', 'Build the presentation with text and structured layouts.'],
    },
  },
  ru: {
    images: 'Изображения', auto: 'Авто', exact: 'Точно', plan: 'С планом', immediate: 'Без плана', settings: 'Параметры создания',
    count: 'Количество слайдов', exactCount: 'Точное количество слайдов', language: 'Язык презентации', provider: 'Генерация текста',
    research: 'Открытые источники', noResearch: 'Выкл.', usingSource: 'Ваши материалы',
    local: 'Локальный ИИ', start: 'Порядок создания', review: 'Проверить план', direct: 'Сразу к слайдам',
    range: (min: number, max: number) => `Введите целое число от ${min} до ${max}.`,
    modes: {
      auto: ['Автоматически', 'Подобрать изображения по теме презентации.'],
      illustrated: ['Добавить иллюстрации', 'Разместить изображения рядом с текстом.'],
      'image-led': ['Визуальные слайды', 'Отвести больше места изображениям. Текст можно редактировать.'],
      none: ['Без изображений', 'Использовать текст и структурированные макеты.'],
    },
  },
  kk: {
    images: 'Суреттер', auto: 'Авто', exact: 'Нақты', plan: 'Жоспармен', immediate: 'Бірден', settings: 'Жасау параметрлері',
    count: 'Слайд саны', exactCount: 'Слайдтың нақты саны', language: 'Презентация тілі', provider: 'Мәтін жасау',
    research: 'Ашық дереккөздер', noResearch: 'Өшірулі', usingSource: 'Сіздің материалыңыз',
    local: 'Жергілікті ЖИ', start: 'Жасау тәртібі', review: 'Жоспарды тексеру', direct: 'Бірден жасау',
    range: (min: number, max: number) => `${min} мен ${max} аралығындағы бүтін санды енгізіңіз.`,
    modes: {
      auto: ['Автоматты түрде', 'Тақырыпқа сай көрнекіліктерді таңдау.'],
      illustrated: ['Суретті слайдтар', 'Суреттерді өңделетін мәтіннің жанына қою.'],
      'image-led': ['Көрнекі слайдтар', 'Суреттерге көбірек орын беру. Мәтінді өңдеуге болады.'],
      none: ['Суретсіз', 'Мәтін мен құрылымды макеттерді қолдану.'],
    },
  },
};

export type PromptSettings = {
  count: string | null;
  language?: Locale;
  provider?: Provider;
  researchQuery?: string;
  webResearch?: WebResearchMode;
  review: boolean;
  imageMode: ImageMode;
};

export function eligibleProviders(localAuthoring: boolean, alem: boolean, hasSource: boolean): Provider[] {
  const providers: Provider[] = [];
  if (alem && !hasSource) providers.push('alem');
  if (localAuthoring) providers.push('local');
  providers.push('fixture');
  return providers;
}

export function selectedProvider(preferred: Provider | undefined, providers: Provider[]) {
  return preferred && providers.includes(preferred) ? preferred : providers[0];
}

export function validSlideCount(count: string | null) {
  if (count === null) return true;
  const value = Number(count);
  return Number.isInteger(value) && value >= minGeneratedSlides && value <= maxLessonSlides;
}

export function slideCountHint(locale: Locale) {
  return copy[locale].range(minGeneratedSlides,maxLessonSlides);
}

export function HomePromptSettings({locale, settings, providers, researchTopics, hasSource, disabled, onChange}: {
  locale: Locale; settings: PromptSettings; providers: Provider[]; researchTopics: string[]; hasSource: boolean; disabled: boolean;
  onChange(settings: Partial<PromptSettings>): void;
}) {
  const t = copy[locale];
  const language = settings.language ?? locale;
  const researchOptions = [{value: '', label: t.noResearch}, ...researchTopics.map(query => ({value:query, label:query}))];
  const provider = selectedProvider(settings.provider, providers);
  const languageOptions = Object.entries(languages).map(([value, label]) => ({value: value as Locale, label}));
  const names = {fixture: words[locale].fixture, alem: words[locale].live, local: t.local};
  const modelOptions = providers.map(value => ({value, label: names[value]}));
  const validCount = validSlideCount(settings.count);
  const modeLabel = [settings.review ? t.plan : t.immediate, validCount ? settings.count : null].filter(Boolean).join(' · ');
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="home-prompt-images"/>}
        aria-label={t.images} title={`${t.images} · ${t.modes[settings.imageMode][0]}`} disabled={disabled}><ImagesSquareIcon aria-hidden="true"/></DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={9} className="home-image-menu">
        <DropdownMenuGroup><DropdownMenuLabel>{t.images}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={settings.imageMode} onValueChange={value => onChange({ imageMode: value as ImageMode })}>
            {imageModes.map(mode => <DropdownMenuRadioItem key={mode} value={mode} className="home-image-row" closeOnClick>
              <ImageLayoutSample mode={mode}/><span className="home-image-copy"><strong>{t.modes[mode][0]}</strong><small>{t.modes[mode][1]}</small></span>
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" className="home-prompt-settings"/>} disabled={disabled} aria-label={`${modeLabel} · ${t.settings}`} title={t.settings}>
        <SlidersHorizontalIcon aria-hidden="true"/><span>{modeLabel}</span><CaretDownIcon aria-hidden="true"/>
      </PopoverTrigger>
      <PopoverContent align="end" className="home-settings-popup" sideOffset={9}>
        <PopoverTitle><span className="home-settings-symbol"><SlidersHorizontalIcon aria-hidden="true"/></span>{t.settings}</PopoverTitle>
        <div className="home-settings-row"><span className="home-setting-label"><StackIcon aria-hidden="true"/>{t.count}</span>
          <ToggleGroup aria-label={t.count} spacing={0} size="sm" value={[settings.count === null ? 'auto' : 'exact']}
            onValueChange={values => { if(values.length) onChange({ count: values[0] === 'auto' ? null : '8' }); }}>
            <ToggleGroupItem value="auto">{t.auto}</ToggleGroupItem><ToggleGroupItem value="exact">{t.exact}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {settings.count !== null && <div className="home-count-entry"><label className="home-settings-row" htmlFor="home-slide-count"><span className="home-setting-label"><ListNumbersIcon aria-hidden="true"/>{t.exactCount}</span>
          <Input id="home-slide-count" type="number" inputMode="numeric" value={settings.count} min={minGeneratedSlides} max={maxLessonSlides} step={1}
            aria-invalid={!validCount} aria-describedby="home-slide-count-hint" onChange={event => onChange({count: event.target.value})}/>
        </label><small id="home-slide-count-hint" data-invalid={!validCount}>{slideCountHint(locale)}</small></div>}
        <div className="home-settings-row"><span className="home-setting-label"><GlobeHemisphereWestIcon aria-hidden="true"/>{t.language}</span>
          <Select items={languageOptions} value={language} onValueChange={value => { if(value) onChange({language: value}); }}>
            <SelectTrigger aria-label={t.language}><LanguageFlag locale={language}/><SelectValue/></SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}><SelectGroup>{languageOptions.map(item => <SelectItem key={item.value} value={item.value} lang={item.value}><span className="home-language-choice"><LanguageFlag locale={item.value}/>{item.label}</span></SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </div>
        <div className="home-settings-row"><span className="home-setting-label"><CpuIcon aria-hidden="true"/>{t.provider}</span>
          {modelOptions.length > 1 ? <Select items={modelOptions} value={provider} onValueChange={value => { if(value) onChange({provider:value}); }}>
            <SelectTrigger aria-label={t.provider}><SelectValue/></SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}><SelectGroup>{modelOptions.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select> : <span className="home-settings-value">{names[provider]}</span>}
        </div>
        {researchTopics.length > 0 && <div className="home-settings-row"><span className="home-setting-label"><MagnifyingGlassIcon aria-hidden="true"/>{t.research}</span>
          {hasSource ? <span className="home-settings-value">{t.usingSource}</span> :
            <Select items={researchOptions} value={settings.researchQuery ?? ''} onValueChange={value => onChange({researchQuery:value || undefined})}>
              <SelectTrigger aria-label={t.research}><SelectValue/></SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}><SelectGroup>{researchOptions.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>}
        </div>}
        <div className="home-flow-control"><span className="home-setting-label"><PathIcon aria-hidden="true"/>{t.start}</span>
          <ToggleGroup aria-label={t.start} spacing={0} size="sm" value={[settings.review ? 'review' : 'direct']}
            onValueChange={values => { if(values.length) onChange({review: values[0] === 'review'}); }}>
            <ToggleGroupItem value="review"><ListChecksIcon aria-hidden="true"/>{t.review}</ToggleGroupItem><ToggleGroupItem value="direct"><LightningIcon aria-hidden="true"/>{t.direct}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </PopoverContent>
    </Popover>
  </>;
}

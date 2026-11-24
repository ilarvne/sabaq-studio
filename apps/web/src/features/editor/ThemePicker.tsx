import { useState, type CSSProperties, type Ref } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { deckThemes, type Deck, type Locale, type Slide, type Theme } from '@sabaq/lesson/types';
import { themePresets, type ThemeRecommendation } from '@sabaq/lesson/themes';
import { defaultImageStyle, imageStyleNames } from '@sabaq/lesson/image-style';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/coss/collapsible';
import { Radio, RadioGroup } from '@/components/coss/radio-group';
import { Select, SelectItem, SelectLabel, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import { Button } from '@/components/shadcn/button';
import './theme-picker.css';

const copy = {
  en: { label: 'Deck theme', typeSample: 'Aa', browse: 'Preview theme suggestions', group: 'Theme suggestions',
    choose: 'Preview any theme', serif: 'Serif headings', sans: 'Sans-serif headings',
    preview: 'Theme preview', apply: 'Apply previewed theme', sampleNote: 'Layout sample', samples: ['Cover', 'Text and image', 'Chart'] },
  ru: { label: 'Тема оформления', typeSample: 'Аа', browse: 'Посмотреть варианты оформления', group: 'Варианты оформления',
    choose: 'Тема для предпросмотра', serif: 'Заголовки с засечками', sans: 'Заголовки без засечек',
    preview: 'Предпросмотр темы', apply: 'Применить выбранную тему', sampleNote: 'Образец макета', samples: ['Обложка', 'Текст и изображение', 'Диаграмма'] },
  kk: { label: 'Безендіру стилі', typeSample: 'Әә', browse: 'Ұсынылған стильдерді көру', group: 'Ұсынылған стильдер',
    choose: 'Алдын ала көретін стиль', serif: 'Кертікті тақырыптар', sans: 'Кертіксіз тақырыптар',
    preview: 'Стильді алдын ала көру', apply: 'Таңдалған стильді қолдану', sampleNote: 'Макет үлгісі', samples: ['Мұқаба', 'Мәтін мен сурет', 'Диаграмма'] },
};

const themeUses: Record<Theme, Record<'ru' | 'kk', string>> = {
  notebook: { ru: 'обзорные и вводные уроки', kk: 'шолу және кіріспе сабақтар' },
  laboratory: { ru: 'опыты и измерения', kk: 'тәжірибелер мен өлшеулер' },
  steppe: { ru: 'земля, культурное наследие и традиции', kk: 'жер, мәдени мұра және дәстүр' },
  contrast: { ru: 'контрастное изображение на проекторе', kk: 'проектордағы жоғары контраст' },
  editorial: { ru: 'литература, обсуждение и разбор текста', kk: 'әдебиет, пікірталас және мәтін талдау' },
  minimal: { ru: 'сдержанное оформление урока', kk: 'сабақты ұстамды безендіру' },
  blueprint: { ru: 'инженерия, геометрия и технические объяснения', kk: 'инженерия, геометрия және техникалық түсіндірмелер' },
  midnight: { ru: 'астрономия и показ в затемнённом помещении', kk: 'астрономия және қараңғы бөлмеде көрсету' },
  museum: { ru: 'искусство, экспонаты и выставки', kk: 'өнер, жәдігерлер және көрмелер' },
  atlas: { ru: 'география, экосистемы и полевые исследования', kk: 'география, экожүйелер және далалық зерттеулер' },
  chalkboard: { ru: 'проекция в классе и разбор задач', kk: 'сыныпта көрсету және есептерді талдау' },
  newsprint: { ru: 'исторические источники и материалы для печати', kk: 'тарихи дереккөздер және баспа материалдары' },
  'field-notes': { ru: 'полевые отчёты, доказательства и иллюстрированные объяснения', kk: 'далалық есептер, дәлелдер және суретті түсіндірмелер' },
  collage: { ru: 'визуальное сравнение, дизайн и искусство', kk: 'көрнекі салыстыру, дизайн және өнер' },
  spotlight: { ru: 'защита проектов, презентации и ключевые выводы', kk: 'жоба қорғау, таныстырылым және негізгі тұжырымдар' },
  strategy: { ru: 'шахматная тактика, логические задачи и принятие решений', kk: 'шахмат тактикасы, логикалық есептер және шешім қабылдау' },
  signal: { ru: 'грамотность в работе с данными, диаграммы и сравнения', kk: 'деректер сауаттылығы, диаграммалар және салыстырулар' },
};

const optionsFor: Partial<Record<ThemeRecommendation['reason'], Theme[]>> = {
  reading: ['editorial', 'minimal', 'museum', 'notebook'],
  history: ['steppe', 'museum', 'editorial', 'atlas'],
  arts: ['museum', 'collage', 'editorial', 'steppe'],
  experiment: ['laboratory', 'field-notes', 'blueprint', 'notebook'],
  geography: ['atlas', 'steppe', 'laboratory', 'notebook'],
  worked: ['blueprint', 'laboratory', 'minimal', 'notebook'],
  night: ['midnight', 'laboratory', 'blueprint', 'contrast'],
  strategy: ['strategy', 'blueprint', 'spotlight', 'chalkboard'],
  data: ['signal', 'blueprint', 'laboratory', 'minimal'],
};

// The selected preset still renders for decks saved with the earlier catalog.
const availableThemes = deckThemes.filter(theme => theme !== 'newsprint');

function previewSlides(deck: Deck) {
  const available = deck.slides.filter(slide => slide.status === 'ready' && !slide.importedPage);
  const opening = available[0];
  const first = deck.outline[0];
  const cover: Slide = {
    id: 'theme-cover', layout: 'cover', status: 'ready', version: 0, lessonPart: 'lesson',
    title: opening?.title || first?.title || deck.title, body: opening?.body || first?.summary || '', notes: '',
  };
  const illustrated = available.find(slide => slide.image);
  const chart = available.find(slide => slide.chart);
  return [
    { sample: 0, slide: cover },
    { sample: 1, placeholder: !illustrated ? 'image' : undefined, slide: {
      ...cover, id: 'theme-image', layout: 'image-right' as const,
      ...(illustrated && { title: illustrated.title, body: illustrated.body, image: illustrated.image }),
    } },
    { sample: 2, placeholder: !chart ? 'chart' : undefined, slide: {
      ...cover, id: 'theme-chart', layout: 'data-chart' as const,
      ...(chart && { title: chart.title, body: chart.body, chart: chart.chart }),
    } },
  ];
}

function ThemeSuggestions({ deck, locale, value, onChange }: {
  deck: Deck; locale: Locale; value: Theme; onChange: (theme: Theme) => void;
}) {
  const t = copy[locale];
  const [preview, setPreview] = useState<Theme>();
  const choices = optionsFor[deck.themeRecommendation?.reason ?? 'general'] ??
    (['editorial', 'blueprint', 'atlas', 'notebook'] satisfies Theme[]);
  const recommended = choices.filter(theme => theme !== value).slice(0, 3);
  const theme = preview ?? recommended[0] ?? value;
  const preset = themePresets[theme];
  const options = availableThemes.map(option => ({ value: option, label: themePresets[option].name[locale] }));
  return <Collapsible className="theme-suggestions">
    <CollapsibleTrigger render={<Button type="button" variant="outline" size="sm" />}>{t.browse}</CollapsibleTrigger>
    <CollapsiblePanel>
      <div className="theme-suggestion-buttons" role="group" aria-label={t.group}>
        {recommended.map(option => <Button key={option} size="sm" variant={option === theme ? 'secondary' : 'ghost'}
          type="button" aria-pressed={option === theme} onClick={() => setPreview(option)}>
          {themePresets[option].name[locale]}
        </Button>)}
      </div>
      <div className="theme-preview-select">
        <Select items={options} value={theme} onValueChange={next => { if (next) setPreview(next); }}>
          <SelectLabel>{t.choose}</SelectLabel>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectPopup>
        </Select>
        <p>{t[preset.heading]} · {imageStyleNames[locale][defaultImageStyle(theme)]} · {locale === 'en' ? preset.use : themeUses[theme][locale]}</p>
      </div>
      <div className="theme-layout-previews" role="group" aria-label={t.preview}>
        {previewSlides(deck).map(({ sample, slide, placeholder }) => <figure key={sample} data-placeholder={placeholder}>
          <div inert><SlideCanvas deck={{ language: deck.language, theme }} slide={slide} revealAnswer={false} /></div>
          <figcaption>{t.samples[sample]}{placeholder && <small>{t.sampleNote}</small>}</figcaption>
        </figure>)}
      </div>
      <Button type="button" size="sm" variant="outline" disabled={theme === value} onClick={() => onChange(theme)}>{t.apply}</Button>
    </CollapsiblePanel>
  </Collapsible>;
}

export function ThemePicker({
  deck,
  locale,
  value,
  onChange,
  triggerRef,
}: {
  deck?: Deck;
  locale: Locale;
  value: Theme;
  onChange: (theme: Theme) => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const label = copy[locale].label;
  const swatchStyle = (theme: Theme) => {
    const { paper, ink, accent, tint, heading } = themePresets[theme];
    return {
      '--sample-paper': paper,
      '--sample-ink': ink,
      '--sample-accent': accent,
      '--sample-tint': tint,
      '--sample-heading':
        heading === 'serif' ? 'var(--font-reading, Georgia, serif)' : 'var(--font-slide, sans-serif)',
    } as CSSProperties;
  };
  return (
    <Collapsible className="theme-picker">
      <CollapsibleTrigger className="theme-picker-trigger" ref={triggerRef}>
        <span className="theme-picker-current" aria-hidden="true" style={swatchStyle(value)}>
          <i />
          <i />
          <i />
        </span>
        <span className="theme-picker-value">
          <small>{label}</small>
          <strong>{themePresets[value].name[locale]}</strong>
        </span>
        <CaretDownIcon className="theme-picker-caret" aria-hidden />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {deck && <ThemeSuggestions deck={deck} locale={locale} value={value} onChange={onChange} />}
        <RadioGroup className="theme-picker-options" aria-label={label} value={value} onValueChange={(next) => onChange(next as Theme)}>
          {availableThemes.map((theme) => (
            <label className="theme-choice" key={theme} data-selected={theme === value}>
              <Radio className="theme-choice-radio" value={theme} aria-label={themePresets[theme].name[locale]} />
              <span
                className="theme-choice-sample"
                data-theme={theme}
                style={swatchStyle(theme)}
                aria-hidden="true"
              >
                <b>{copy[locale].typeSample}</b>
                <i />
              </span>
              <span className="theme-choice-name">{themePresets[theme].name[locale]}</span>
            </label>
          ))}
        </RadioGroup>
      </CollapsiblePanel>
    </Collapsible>
  );
}

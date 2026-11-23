import { useState, type CSSProperties } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { deckThemes, type Deck, type Locale, type Slide, type Theme } from '@sabaq/lesson/types';
import { themePresets, type ThemeRecommendation } from '@sabaq/lesson/themes';
import { SlideCanvas } from '@sabaq/slide-renderer/canvas';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/coss/collapsible';
import { Radio, RadioGroup } from '@/components/coss/radio-group';
import { Button } from '@/components/shadcn/button';
import './theme-picker.css';

const copy = {
  en: { label: 'Deck theme', typeSample: 'Aa', browse: 'Preview theme suggestions', group: 'Theme suggestions',
    preview: 'Theme preview', apply: 'Apply previewed theme', sampleNote: 'Layout sample', samples: ['Cover', 'Text and image', 'Chart'] },
  ru: { label: 'Тема оформления', typeSample: 'Аа', browse: 'Посмотреть варианты оформления', group: 'Варианты оформления',
    preview: 'Предпросмотр темы', apply: 'Применить выбранную тему', sampleNote: 'Образец макета', samples: ['Обложка', 'Текст и изображение', 'Диаграмма'] },
  kk: { label: 'Безендіру стилі', typeSample: 'Әә', browse: 'Ұсынылған стильдерді көру', group: 'Ұсынылған стильдер',
    preview: 'Стильді алдын ала көру', apply: 'Таңдалған стильді қолдану', sampleNote: 'Макет үлгісі', samples: ['Мұқаба', 'Мәтін мен сурет', 'Диаграмма'] },
};

const optionsFor: Partial<Record<ThemeRecommendation['reason'], Theme[]>> = {
  reading: ['editorial', 'newsprint', 'minimal', 'museum'],
  history: ['steppe', 'museum', 'newsprint', 'editorial'],
  arts: ['museum', 'editorial', 'steppe', 'minimal'],
  experiment: ['laboratory', 'blueprint', 'notebook', 'minimal'],
  geography: ['atlas', 'steppe', 'laboratory', 'notebook'],
  worked: ['blueprint', 'laboratory', 'minimal', 'notebook'],
  night: ['midnight', 'laboratory', 'blueprint', 'contrast'],
};

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
  const theme = preview && recommended.includes(preview) ? preview : recommended[0];
  return <Collapsible className="theme-suggestions">
    <CollapsibleTrigger render={<Button type="button" variant="outline" size="sm" />}>{t.browse}</CollapsibleTrigger>
    <CollapsiblePanel>
      <div className="theme-suggestion-buttons" role="group" aria-label={t.group}>
        {recommended.map(option => <Button key={option} size="sm" variant={option === theme ? 'secondary' : 'ghost'}
          type="button" aria-pressed={option === theme} onClick={() => setPreview(option)}>
          {themePresets[option].name[locale]}
        </Button>)}
      </div>
      <div className="theme-layout-previews" role="group" aria-label={t.preview}>
        {previewSlides(deck).map(({ sample, slide, placeholder }) => <figure key={sample} data-placeholder={placeholder}>
          <div inert><SlideCanvas deck={{ language: deck.language, theme }} slide={slide} revealAnswer={false} /></div>
          <figcaption>{t.samples[sample]}{placeholder && <small>{t.sampleNote}</small>}</figcaption>
        </figure>)}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => onChange(theme)}>{t.apply}</Button>
    </CollapsiblePanel>
  </Collapsible>;
}

export function ThemePicker({
  deck,
  locale,
  value,
  onChange,
}: {
  deck?: Deck;
  locale: Locale;
  value: Theme;
  onChange: (theme: Theme) => void;
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
      <CollapsibleTrigger className="theme-picker-trigger">
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
          {deckThemes.map((theme) => (
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

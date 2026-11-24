import { BooksIcon, FileTextIcon, PresentationChartIcon, SquaresFourIcon } from '@phosphor-icons/react';
import type { Locale } from '@sabaq/lesson/types';
import { Button, buttonVariants } from '@/components/shadcn/button';
import './quick-start.css';

const copy = {
  en: {
    title: 'Quick start',
    templates: 'From a template',
    file: 'Use source material',
    source: 'Material library',
    pptx: 'Import slides',
    examples: 'Try a topic',
    topics: [
      [
        'The water cycle',
        'Explain the water cycle to a fifth-grade class. Include a simple evaporation experiment.',
      ],
      ['Reading a graph', 'Teach students to read a bar graph, compare values, and check their conclusions.'],
    ],
  },
  ru: {
    title: 'Быстрый старт',
    templates: 'Из шаблона',
    file: 'Из документа',
    source: 'Из библиотеки',
    pptx: 'Импорт слайдов',
    examples: 'Примеры тем',
    topics: [
      ['Круговорот воды', 'Объясни круговорот воды пятиклассникам и предложи простой опыт с испарением.'],
      [
        'Чтение графиков',
        'Научи школьников читать столбчатые диаграммы, сравнивать значения и проверять выводы.',
      ],
    ],
  },
  kk: {
    title: 'Жылдам бастау',
    templates: 'Сабақ үлгісінен',
    file: 'Құжаттан жасау',
    source: 'Кітапханадан',
    pptx: 'Слайдтарды жүктеу',
    examples: 'Тақырып мысалдары',
    topics: [
      [
        'Су айналымы',
        'Бесінші сыныпқа табиғаттағы су айналымын түсіндіріп, булануды көрсететін қарапайым тәжірибе ұсын.',
      ],
      [
        'Диаграмманы оқу',
        'Оқушыларға бағанды диаграмманы оқуды, мәндерді салыстыруды және қорытындыны тексеруді үйрет.',
      ],
    ],
  },
} as const;

export function QuickStart({
  locale,
  onStart,
  onSuggest,
}: {
  locale: Locale;
  onStart: (mode: 'file' | 'source' | 'pptx') => void;
  onSuggest: (text: string) => void;
}) {
  const c = copy[locale];
  return (
    <div className="hero-shortcuts">
      <section aria-label={c.title} className="hero-methods">
        <a href="#/templates" data-tone="amber" className={buttonVariants({ variant: 'outline', className: 'hero-method' })}>
          <span className="hero-method-icon"><SquaresFourIcon aria-hidden="true" weight="duotone" /></span>
          <span>{c.templates}</span>
        </a>
        {(
          [
            { mode: 'file', Icon: FileTextIcon, tone: 'teal' },
            { mode: 'source', Icon: BooksIcon, tone: 'violet' },
            { mode: 'pptx', Icon: PresentationChartIcon, tone: 'rose' },
          ] as const
        ).map(({ mode, Icon, tone }) => (
          <Button
            type="button"
            key={mode}
            variant="outline"
            className="hero-method"
            data-tone={tone}
            onClick={() => onStart(mode)}
          >
            <span className="hero-method-icon"><Icon aria-hidden="true" weight="duotone" /></span>
            <span>{c[mode]}</span>
          </Button>
        ))}
      </section>
      <div className="hero-example-row">
        <span>{c.examples}</span>
        {c.topics.map(([label, brief]) => (
          <button type="button" key={label} onClick={() => onSuggest(brief)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useId } from 'react';
import { ArrowRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { lessonTemplates, type TemplateId } from '@sabaq/lesson/lesson-templates';
import type { Locale } from '@sabaq/lesson/types';
import { Button, buttonVariants } from '@/components/shadcn/button';
import './template-gallery.css';

const copy = {
  en: { heading: 'Featured templates', all: 'View all' },
  ru: { heading: 'Подборка шаблонов', all: 'Все шаблоны' },
  kk: { heading: 'Таңдаулы үлгілер', all: 'Барлығын көру' },
};

const templates = [
  {
    id: 'explain',
    art: 'solar-system',
    en: { subject: 'Astronomy', lines: ['The Solar', 'System'], topic: 'The Solar System' },
    ru: { subject: 'Астрономия', lines: ['Солнечная', 'система'], topic: 'Солнечная система' },
    kk: { subject: 'Астрономия', lines: ['Күн', 'жүйесі'], topic: 'Күн жүйесі' },
  },
  {
    id: 'fieldwork',
    art: 'field-notes',
    en: { subject: 'Botany', lines: ['Botanical', 'Field Notes'], topic: 'Botanical Field Notes' },
    ru: { subject: 'Ботаника', lines: ['Полевые', 'заметки'], topic: 'Полевые заметки ботаника' },
    kk: { subject: 'Ботаника', lines: ['Дала', 'күнделігі'], topic: 'Ботаниктің дала күнделігі' },
  },
  {
    id: 'revise',
    art: 'shape-studies',
    en: { subject: 'Mathematics', lines: ['Shape', 'Studies'], topic: 'Shape Studies' },
    ru: { subject: 'Математика', lines: ['Мир', 'фигур'], topic: 'Мир геометрических фигур' },
    kk: { subject: 'Математика', lines: ['Пішіндер', 'әлемі'], topic: 'Геометриялық пішіндер әлемі' },
  },
  {
    id: 'statistics',
    art: 'data-stories',
    en: { subject: 'Statistics', lines: ['Data', 'Stories'], topic: 'Data Stories' },
    ru: { subject: 'Статистика', lines: ['Язык', 'данных'], topic: 'Язык данных' },
    kk: { subject: 'Статистика', lines: ['Деректер', 'тілі'], topic: 'Деректер тілі' },
  },
  {
    id: 'music',
    art: 'sound-waves',
    en: { subject: 'Music', lines: ['Sound', 'Waves'], topic: 'Sound Waves' },
    ru: { subject: 'Музыка', lines: ['Звуковые', 'волны'], topic: 'Звуковые волны' },
    kk: { subject: 'Музыка', lines: ['Дыбыс', 'толқыны'], topic: 'Дыбыс толқыны' },
  },
] as const;

interface TemplateGalleryProps {
  locale: Locale;
  onChoose: (template: TemplateId, topic: string) => void;
}

export function TemplateGallery({ locale, onChoose }: TemplateGalleryProps) {
  const headingId = useId();
  const labels = copy[locale];
  return (
    <section className="featured-templates" aria-labelledby={headingId}>
      <div className="featured-templates-heading">
        <h2 id={headingId}>{labels.heading}</h2>
        <a
          href="#/templates"
          className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'featured-templates-link' })}
        >
          {labels.all}
          <ArrowRightIcon aria-hidden data-motion-arrow />
        </a>
      </div>
      <div className="featured-templates-grid">
        {templates.map((template) => {
          const { subject, lines, topic } = template[locale];
          return (
            <Button
              key={template.id}
              className="featured-template"
              type="button"
              variant="ghost"
              data-art={template.art}
              onClick={() => onChoose(template.id, topic)}
            >
              <span className="featured-template-cover" aria-hidden="true">
                <img
                  src={`/assets/templates/${template.art}.svg`}
                  width="640"
                  height="360"
                  alt=""
                  draggable="false"
                />
                <span className="featured-template-subject">{subject}</span>
                <span className="featured-template-title">
                  {lines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              </span>
              <span className="featured-template-caption">
                <span>
                  <strong>{topic}</strong>
                  <span>{lessonTemplates[template.id].name[locale]}</span>
                </span>
                <ArrowUpRightIcon aria-hidden />
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

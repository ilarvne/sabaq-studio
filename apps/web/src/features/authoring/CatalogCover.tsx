import { lessonTemplates, templateSubjects, type TemplateId } from '@sabaq/lesson/lesson-templates';
import type { Locale } from '@sabaq/lesson/types';

const art = {
  measurement:'lab', explain:'fern', revise:'geometry', assessment:'graph', meeting:'book', defense:'plan',
  reading:'book', writing:'pages', vocabulary:'book', debate:'pages', archive:'archive', chronology:'archive',
  proof:'geometry', problem:'plan', statistics:'graph', fieldwork:'fern', engineering:'plan', debugging:'graph',
  critique:'geometry', music:'wave',
} as const;

const illustrations = {fern:'field-notes', geometry:'shape-studies', graph:'data-stories', wave:'sound-waves'} as const;

export function CatalogCover({ id, locale, topic }: { id:TemplateId; locale:Locale; topic?:string }) {
  const preset = lessonTemplates[id];
  const kind = art[id];
  const image = kind in illustrations ? illustrations[kind as keyof typeof illustrations] : undefined;
  return <span className="catalog-art" data-kind={kind} data-template={id}>
    {image ? <img src={`/assets/templates/${image}.svg`} width="640" height="360" alt="" loading="lazy"/> :
      <svg viewBox="0 0 320 180" className="catalog-drawing" focusable="false" aria-hidden="true">
        {kind === 'lab' && <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
          <path d="M197 34h28m-23 0v49l-32 54q-4 7 4 7h73q8 0 4-8l-31-54V34"/>
          <path d="m190 105-18 32q-2 4 4 4h68q6 0 4-4l-19-34q-13 9-23 3t-16-1Z" fill="currentColor" opacity=".37"/>
          <path d="M191 106q9-6 18 1t20-3m34-42h29m-25 0v67a10 10 0 0 0 20 0V62m-20 28q6-4 12 0t8-1m-81-42h4m-4 8h6m-6 8h4m-4 8h6m62 5h5m-5 8h8m-8 15h5m-5 8h8"/>
          <circle cx="207" cy="125" r="2.5"/><circle cx="218" cy="115" r="1.6"/><circle cx="213" cy="96" r="1.8"/>
          <path d="M157 149h141m-130 5h100" opacity=".5"/>
        </g>}
        {kind === 'plan' && <g fill="none" stroke="currentColor" strokeWidth="1">
          <g transform="translate(4 2)"><path d="m151 117 69-63 70 54-68 44z" fill="currentColor" opacity=".15"/>
            <path d="m151 117 69-63 70 54-68 44zM151 117l70 5 69-14m-102-24 34 68 33-73M220 54l1 68m-71-4 2 20 71 31 67-43v-18m-67 44v17"/>
            <path d="m147 109 71-65 77 61m-141 38 64 29m-56-70 114-13" strokeDasharray="3 3" opacity=".6"/>
            <g fill="currentColor"><circle cx="151" cy="117" r="2.2"/><circle cx="220" cy="54" r="2.2"/><circle cx="290" cy="108" r="2.2"/><circle cx="222" cy="152" r="2.2"/></g>
          </g></g>}
        {(kind === 'book' || kind === 'pages' || kind === 'archive') && <g transform={kind === 'archive' ? 'translate(11 0) rotate(6 220 95)' : 'rotate(-9 225 99)'}>
          <g fill="var(--catalog-page)" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="m166 61 54-7 24 9 39-6v82l-42 6-22-8-54 6z" transform="translate(4 5)"/>
            <path d="m166 61 54-7 24 9 39-6v82l-42 6-22-8-54 6z"/>
            <path d="m165 57 53-8 23 10 40-7v82l-40 7-23-10-53 8z"/>
            <path d="m164 52 53-7 23 10 39-6v82l-40 6-22-10-53 7zM217 45v82m23-72-1 82"/>
          </g>
          <g fill="none" stroke="currentColor" opacity=".65" strokeWidth="1">
            <path d="m172 63 33-5m-33 12 28-4m-28 12 37-5m-37 12 24-3m-24 11 35-5m-35 12 33-5m42-30 21-3m-21 10 18-2m-18 10 24-4m-24 12 17-3m-17 11 21-4"/>
          </g>
        </g>}
      </svg>}
    <span className="catalog-art-subject">{templateSubjects[preset.subject][locale]}</span>
    <strong className="catalog-art-title">{topic?.trim() || preset.topic[locale]}</strong>
  </span>;
}

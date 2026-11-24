import type { Locale } from '@sabaq/lesson/types';
import type { ConflictField } from './slide-edit-merge';

const labels = {
  en: {
    compare: 'Compare the two edits', yours: 'Your edit', saved: 'Saved version',
    title: 'Slide title', body: 'Slide text', notes: 'Speaker notes', layout: 'Layout', freeLayout: 'Free layout',
    image: 'Image', additionalImages: 'Image grid', table: 'Table', chart: 'Chart', diagram: 'Diagram', objects: 'Canvas objects', coverArtwork: 'Cover artwork',
    answer: 'Answer', design: 'Content blocks', powerPointLayoutId: 'PowerPoint layout',
  },
  ru: {
    compare: 'Сравнить правки', yours: 'Ваша правка', saved: 'Сохранённая версия',
    title: 'Заголовок слайда', body: 'Текст слайда', notes: 'Заметки докладчика', layout: 'Макет', freeLayout: 'Свободный макет',
    image: 'Изображение', additionalImages: 'Сетка изображений', table: 'Таблица', chart: 'Диаграмма', diagram: 'Схема', objects: 'Объекты слайда', coverArtwork: 'Декор обложки',
    answer: 'Ответ', design: 'Блоки содержимого', powerPointLayoutId: 'Макет PowerPoint',
  },
  kk: {
    compare: 'Екі өзгерісті салыстыру', yours: 'Сіздің өзгерісіңіз', saved: 'Сақталған нұсқа',
    title: 'Слайд тақырыбы', body: 'Слайд мәтіні', notes: 'Баяндамашы жазбалары', layout: 'Орналасу', freeLayout: 'Еркін орналасу',
    image: 'Сурет', additionalImages: 'Суреттер торы', table: 'Кесте', chart: 'Диаграмма', diagram: 'Сұлба', objects: 'Слайдтағы нысандар', coverArtwork: 'Мұқаба өрнегі',
    answer: 'Жауап', design: 'Мазмұн блоктары', powerPointLayoutId: 'PowerPoint макеті',
  },
};

export function EditConflictDetails({ locale, fields }: { locale: Locale; fields: ConflictField[] }) {
  if (!fields.length) return null;
  const t = labels[locale];
  return <details className="basis-full">
    <summary className="cursor-pointer">{t.compare}</summary>
    {fields.map(({field,yours,saved}) => <div key={field} className="mt-2 grid gap-2 sm:grid-cols-2">
      {([[t.yours,yours],[t.saved,saved]] as const).map(([label,value]) => <label key={label} className="min-w-0 text-foreground">
        {t[field]} · {label}
        <textarea readOnly rows={3} value={value} className="mt-1 block w-full rounded-md border bg-background p-2"/>
      </label>)}
    </div>)}
  </details>;
}

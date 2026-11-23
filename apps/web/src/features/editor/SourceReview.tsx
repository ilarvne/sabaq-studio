import type { Locale, Slide } from '@sabaq/lesson/types';

const copy = {
  en: { title:'Source review', withheld:'The draft contained claims the cited passages did not support. This slide uses source excerpts instead.',
    numbers:'Numbers and dates to verify', quotations:'Unverified quotations', citations:'Unknown source references' },
  ru: { title:'Проверка по источнику', withheld:'В черновике были утверждения, которые не подтверждаются указанными отрывками. На слайде использованы отрывки из источника.',
    numbers:'Числа и даты для проверки', quotations:'Неподтверждённые цитаты', citations:'Неизвестные ссылки на источник' },
  kk: { title:'Дереккөзді тексеру', withheld:'Нобайдағы кей тұжырымдар келтірілген үзінділермен расталмады. Слайдта дереккөзден алынған үзінділер қолданылды.',
    numbers:'Тексерілетін сандар мен күндер', quotations:'Расталмаған дәйексөздер', citations:'Белгісіз дереккөз сілтемелері' },
};

export function SourceReview({report,locale}:{report:NonNullable<Slide['sourceReview']>;locale:Locale}) {
  const labels=copy[locale];
  const number=new Intl.NumberFormat(locale);
  return <section className="inspect-section" aria-label={labels.title}>
    <h3 className="inspect-label">{labels.title}</h3>
    <p>{labels.withheld}</p>
    <ul>
      {!!report.numbers.length && <li>{labels.numbers} · {report.numbers.join(', ')}</li>}
      {!!report.quotations && <li>{labels.quotations} · {number.format(report.quotations)}</li>}
      {!!report.unknownCitations && <li>{labels.citations} · {number.format(report.unknownCitations)}</li>}
    </ul>
  </section>;
}

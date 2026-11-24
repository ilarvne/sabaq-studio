import type { FreeLayout } from '@sabaq/lesson/free-layout';
import { defaultImageCrop } from '@sabaq/lesson/image-crop';
import type { DemoLesson } from './demo-lesson';

const processLayout: FreeLayout = {
  items: [
    { id: 'eyebrow', x: 5, y: 5, w: 90, h: 6, rotation: 0 },
    { id: 'title', x: 5, y: 13, w: 90, h: 15, rotation: 0 },
    { id: 'body', x: 5, y: 31, w: 90, h: 11, rotation: 0 },
    { id: 'diagram', x: 5, y: 46, w: 90, h: 47, rotation: 0 },
  ],
};

export const seedlingLessons: DemoLesson[] = [
  {
    key: 'seedlings',
    language: 'kk',
    theme: 'field-notes',
    template: 'explain',
    topic: 'Үрмебұршақ тұқымының өнуін бақылау',
    sourceText: `Үрмебұршақ қалай өнеді?

Тәжірибе үшін екі ыдысқа бес-бестен үрмебұршақ тұқымын салыңдар. Бір ыдыстағы қағаз сүлгіні ылғалды, екіншісін құрғақ ұстаңдар. Екі ыдыс бір жерде тұрсын. Күн сайын бір уақытта тамыры көрінген тұқымдарды санаңдар.

Үлгі деректер. Бақылаудың 1, 3 және 5-күнінде ылғалды сүлгіде тиісінше 0, 3 және 5 тұқым өнді. Құрғақ сүлгіде үш бақылауда да 0 тұқым өнді. Бұл сандар сабақ үшін құрастырылған. Тәжірибеде өздерің алған нәтижені жазыңдар.`,
    slides: [
      {
        layout: 'cover',
        lessonPart: 'lesson',
        title: 'Үрмебұршақ қалай өнеді?',
        body: 'Тұқымдағы өзгерістерді бақылап, екі тәжірибенің нәтижесін салыстырамыз.',
        notes: 'Құрғақ тұқымды көрсетіңіз. Оқушылардан қандай өзгерісті бірінші байқайтынын болжап, жауабын жазуды сұраңыз.',
      },
      {
        layout: 'image-right',
        lessonPart: 'recall',
        title: 'Өскіннің бөліктері',
        body: 'Суреттен сабақ пен жапырақтарды табыңдар. Тамыр қайда?',
        notes: 'Оқушылардан сабақ пен жапырақтарды көрсетуді сұраңыз. Тамыр топырақ астында жатқандықтан көрінбейтінін талқылаңыз.',
        image: {
          src: '/assets/seedling-growth.webp',
          crop: defaultImageCrop,
          alt: 'Топырақтан шыққан жасыл сабақты, жапырақты үрмебұршақ өскіні',
          provenance: { source: 'catalog', asset: 'seedling-growth' },
        },
      },
      {
        layout: 'body',
        lessonPart: 'new-material',
        freeLayout: processLayout,
        title: 'Өну кезеңдері',
        body: 'Алғашқы тамыр шыққанда тұқым өнді деп есептейміз.',
        notes: 'Кезеңдерді ретімен оқытыңыз. Тамыр мен өркеннің қайсысы бірінші шығатынын сұраңыз.',
        diagram: {
          kind: 'process',
          nodes: ['Тұқым су сіңіреді', 'Қабығы жарылады', 'Тамыр шығады', 'Өркен өседі'],
        },
      },
      {
        layout: 'stacked',
        lessonPart: 'practice',
        title: 'Тәжірибені дайындайық',
        body: 'Екі ыдысқа бес-бестен тұқым салыңдар. Бір сүлгі ылғалды, екіншісі құрғақ болсын. Ыдыстарды бір жерге қойыңдар.',
        notes: 'Ыдыстарға белгі қойғызыңыз. Екі ыдысқа бірдей тұқым салынып, жарық пен температура ортақ болуын қадағалаңыз.',
      },
      {
        layout: 'native-table',
        lessonPart: 'example',
        title: 'Өнген тұқымдарды санайық',
        body: 'Мына үлгіге қарап, өз нәтижелеріңді кестеге жазыңдар.',
        notes: 'Тұқымдарды күн сайын бір уақытта санауды тапсырыңыз. Кестедегі сандар сабақ үшін құрастырылғанын айтыңыз.',
        table: {
          headers: ['Күн', 'Ылғалды сүлгі', 'Құрғақ сүлгі'],
          rows: [[1, 0, 0], [3, 3, 0], [5, 5, 0]],
        },
      },
      {
        layout: 'centered',
        lessonPart: 'check',
        title: 'Кестені қалай түсіндіреміз?',
        body: 'Үлгі деректер бойынша 5-күнде қай ыдыста көп тұқым өнді? Жауабыңды екі санмен дәлелде.',
        answer: 'Ылғалды сүлгіде 5 тұқым өнді, құрғақ сүлгіде бірде-бір тұқым өнбеді.',
        notes: 'Жауапты ашпас бұрын оқушылардың кестеден екі санды да тапқанын тексеріңіз. Нәтижені су мөлшерімен байланыстырыңыз.',
      },
    ],
  },
  {
    key: 'seedlings',
    language: 'ru',
    theme: 'field-notes',
    template: 'explain',
    topic: 'Наблюдаем за прорастанием фасоли',
    sourceText: `Как прорастает фасоль?

Положите по пять семян фасоли в два контейнера. В одном контейнере поддерживайте бумажное полотенце влажным, в другом оставьте его сухим. Поставьте контейнеры рядом. Каждый день в одно и то же время подсчитывайте семена, у которых появился корешок.

Учебные данные. На 1-й, 3-й и 5-й день на влажном полотенце проросло соответственно 0, 3 и 5 семян. На сухом полотенце во всех трёх наблюдениях проросло 0 семян. Цифры придуманы для урока. В опыте записывайте собственные результаты.`,
    slides: [
      {
        layout: 'cover',
        lessonPart: 'lesson',
        title: 'Как прорастает фасоль?',
        body: 'Проследим за изменениями семени и сравним результаты двух опытов.',
        notes: 'Покажите сухое семя. Попросите учеников предположить, какое изменение они заметят первым, и записать ответ.',
      },
      {
        layout: 'image-right',
        lessonPart: 'recall',
        title: 'Из чего состоит росток?',
        body: 'Найдите на изображении стебель и листья. Где у растения корень?',
        notes: 'Попросите учеников указать стебель и листья. Обсудите, почему корень ростка на изображении скрыт под землёй.',
        image: {
          src: '/assets/seedling-growth.webp',
          crop: defaultImageCrop,
          alt: 'Зелёный росток фасоли со стеблем и листьями над поверхностью почвы',
          provenance: { source: 'catalog', asset: 'seedling-growth' },
        },
      },
      {
        layout: 'body',
        lessonPart: 'new-material',
        freeLayout: processLayout,
        title: 'Этапы прорастания',
        body: 'Будем считать семя проросшим, когда у него появится корешок.',
        notes: 'Прочитайте шаги вместе с классом. Спросите, что появляется раньше, корешок или побег.',
        diagram: {
          kind: 'process',
          nodes: ['Семя впитывает воду', 'Оболочка трескается', 'Появляется корешок', 'Растёт побег'],
        },
      },
      {
        layout: 'stacked',
        lessonPart: 'practice',
        title: 'Готовим опыт',
        body: 'Разложите по пять семян в два контейнера. Смочите полотенце в одном, а второе оставьте сухим. Поставьте контейнеры рядом.',
        notes: 'Подпишите контейнеры. Убедитесь, что в каждом одинаковое количество семян и что условия освещения и температура совпадают.',
      },
      {
        layout: 'native-table',
        lessonPart: 'example',
        title: 'Считаем проросшие семена',
        body: 'Запишите свои наблюдения в таблицу по этому образцу.',
        notes: 'Договоритесь, в какое время класс будет считать семена каждый день. Объясните, что числовые данные на слайде учебные.',
        table: {
          headers: ['День', 'Влажное полотенце', 'Сухое полотенце'],
          rows: [[1, 0, 0], [3, 3, 0], [5, 5, 0]],
        },
      },
      {
        layout: 'centered',
        lessonPart: 'check',
        title: 'Что показывает таблица?',
        body: 'Где к пятому дню проросло больше семян? Подтвердите ответ двумя значениями из таблицы.',
        answer: 'На влажном полотенце проросло 5 семян, на сухом — 0.',
        notes: 'Попросите учеников найти оба значения до показа ответа. Обсудите, как наличие воды могло повлиять на результат.',
      },
    ],
  },
  {
    key: 'seedlings',
    language: 'en',
    theme: 'field-notes',
    template: 'explain',
    topic: 'Observing bean seed germination',
    sourceText: `How does a bean seed sprout?

Place five bean seeds in each of two containers. Keep the paper towel in one container moist and leave the other dry. Set the containers side by side. At the same time each day, count the seeds with a visible root.

Sample data. On days 1, 3 and 5, the moist towel had 0, 3 and 5 sprouted seeds. The dry towel had 0 sprouted seeds on all three days. These numbers were made up for this lesson. Record your own results when you run the experiment.`,
    slides: [
      {
        layout: 'cover',
        lessonPart: 'lesson',
        title: 'How does a bean seed sprout?',
        body: 'Follow a bean seed as it changes and compare what happens with and without water.',
        notes: 'Show the class a dry bean seed. Ask students to predict and write down the first change they expect to see.',
      },
      {
        layout: 'image-right',
        lessonPart: 'recall',
        title: 'Parts of a seedling',
        body: 'Find the stem and leaves in the picture. Where is the root?',
        notes: 'Invite students to point to the stem and leaves. Discuss why the root in this picture is hidden under the soil.',
        image: {
          src: '/assets/seedling-growth.webp',
          crop: defaultImageCrop,
          alt: 'Bean seedling with a green stem and leaves above the soil',
          provenance: { source: 'catalog', asset: 'seedling-growth' },
        },
      },
      {
        layout: 'body',
        lessonPart: 'new-material',
        freeLayout: processLayout,
        title: 'From seed to shoot',
        body: 'Count a seed as sprouted once you can see its first root.',
        notes: 'Read through the steps together. Ask students to point to the stage when a seed first counts as sprouted.',
        diagram: {
          kind: 'process',
          nodes: ['Seed takes in water', 'Seed coat splits', 'First root emerges', 'Shoot grows'],
        },
      },
      {
        layout: 'stacked',
        lessonPart: 'practice',
        title: 'Set up a fair comparison',
        body: 'Put five seeds in each container. Keep one paper towel moist and the other dry. Set the two containers side by side.',
        notes: 'Ask students to label the containers. Check that each has the same number of seeds and gets the same light and warmth.',
      },
      {
        layout: 'native-table',
        lessonPart: 'example',
        title: 'Count the sprouted seeds',
        body: 'Use this sample table to plan how you will record your observations.',
        notes: 'Agree on a time for the class to count seeds each day. Explain that the numbers shown are made up for practice.',
        table: {
          headers: ['Day', 'Moist towel', 'Dry towel'],
          rows: [[1, 0, 0], [3, 3, 0], [5, 5, 0]],
        },
      },
      {
        layout: 'centered',
        lessonPart: 'check',
        title: 'What does the table show?',
        body: 'Which container had more sprouts by day 5? Use two numbers from the table to support your answer.',
        answer: 'Five seeds sprouted on the moist towel and zero sprouted on the dry towel.',
        notes: 'Let students locate both values before revealing the answer. Discuss how water could have affected the result.',
      },
    ],
  },
];

import { defaultImageCrop } from '@sabaq/lesson/image-crop';
import type { DemoLesson } from './demo-lesson';

function illustration(asset: 'kindness-schoolyard' | 'kindness-notebooks', alt: string) {
  return { src: `/assets/${asset}.webp`, alt, crop: defaultImageCrop, provenance: { source: 'catalog' as const, asset } };
}

export const kindnessLessons: DemoLesson[] = [
  {
    key: 'kindness',
    language: 'kk',
    theme: 'steppe',
    template: 'meeting',
    topic: 'Сыныптасыңа қалай көмектесуге болады?',
    sourceText: 'Сынып сағатының мақсаты — оқушыларға көмек ұсынуды және сыныптасының жауабын сыйлауды үйрету. Үш қадам: не болып жатқанын байқа, қандай көмек ұсына алатыныңды айт та сұра, жауабын тыңда. Бір суретте бала үзілісте орындықта отыр, ал басқа балалар аулада доп ойнап жүр. Оған ойынға қосылуды ұсынуға болады. Екінші суретте екі оқушы дәлізде дәптер жинап жатыр. «Дәптерлерді жинауға көмектесейін бе?» деген сұрақ адамға таңдау қалдырады. Жұптық жаттығуда оқушы тапсырманың бірінші қадамын түсінбей отыр, ал сыныптасы оны бірге оқуды ұсынады. Егер оқушы «Рақмет, алдымен өзім көрейін» десе, «Жарайды, көмек керек болса, айта ғой» деп жауап беруге болады. Сабақ соңында әр оқушы көмек ұсынатын бір сұрақ пен бас тартқан адамға айтатын бір жауап жазады.',
    slides: [
      {
        layout: 'cover', lessonPart: 'goal',
        title: 'Сыныптасыңа қалай көмектесуге болады?',
        body: 'Көмек ұсынуды және сыныптасыңның жауабын сыйлауды үйренеміз.',
        notes: 'Суретке қарап, балалардан не көріп тұрғанын сұраңыз. Әуелі қол қимылын, орындықты және доп ойынын атасын. Содан кейін қыздың не айтуы мүмкін екенін болжасын.',
        image: illustration('kindness-schoolyard', 'Мектеп ауласында қыз орындықта отырған балаға қолын созып тұр.'),
      },
      {
        layout: 'image-right', lessonPart: 'new-material',
        title: 'Байқа, сұра, тыңда',
        body: 'Дәптерлер жерге түсіп қалды. «Жинауға көмектесейін бе?» деп сұра да, жауабын күт.',
        notes: 'Көмек ұсынғаннан кейін кідіріп, жауап күту керегін көрсетіңіз. Бір оқушы «Иә, мына екеуін алшы», екіншісі «Рақмет, өзім жинаймын» деп жауап берсін. Екі жауапты да қабылдауға болатынын айтыңыз.',
        image: illustration('kindness-notebooks', 'Мектеп дәлізінде екі оқушы жердегі дәптерлерді жинап жатыр.'),
      },
      {
        layout: 'image-grid', lessonPart: 'example',
        title: 'Бұл екі жағдайда не айтар едің?',
        body: 'Аулада — «Бізбен ойнағың келе ме?»\nДәлізде — «Дәптерлерді жинауға көмектесейін бе?»',
        notes: 'Алдымен жұптар әр суретте болып жатқан оқиғаны сипаттасын. Содан кейін дайын сөйлемді оқып, сол жағдайға сай өз сұрағын айтсын. Оқушылардан сұрақтың қандай таңдау қалдыратынын сұраңыз.',
        image: illustration('kindness-schoolyard', 'Аулада бала орындықта отыр, ал басқа балалар доп ойнап жүр.'),
        additionalImages: [illustration('kindness-notebooks', 'Дәлізде екі оқушы едендегі дәптерлерді алып жатыр.')],
      },
      {
        layout: 'stacked', lessonPart: 'practice',
        title: 'Жұппен сөйлесіп көріңдер',
        body: 'Сыныптасың тапсырманың бірінші қадамын түсінбей отыр. Бірге оқуды ұсын, жауабын күт. Рөл ауыстырып, бұл жолы көмектен сыпайы бас тартыңдар.',
        notes: 'Әр айналымға бір минут беріңіз. Бір оқушы тапсырманы орындаушы, екіншісі көмек ұсынушы болсын. Соңында жұптар көмек нақты ұсынылды ма және жауапты күтуге уақыт берілді ме деп тексерсін.',
      },
      {
        layout: 'centered', lessonPart: 'check',
        title: '«Рақмет, алдымен өзім көрейін»',
        body: 'Қай жауап орынды?\nА. «Маған бере сал, тезірек бітіремін».\nӘ. «Жарайды, көмек керек болса, айта ғой».\nБ. «Жоқ, мен бәрібір көмектесемін».',
        answer: 'Ә. Сыныптасыңның шешімін сыйлап, кейін көмек сұрауға мүмкіндік бересің.',
        notes: 'Жауапты ашпас бұрын әркім өз нұсқасын таңдасын. Бір оқушыдан қалған нұсқаларда сыныптасының таңдауына не болатынын түсіндіруін сұраңыз.',
      },
      {
        layout: 'body', lessonPart: 'summary',
        title: 'Екі сөйлем жаз',
        body: 'Көмек ұсынатын бір сұрақ жаз. «Қазір керек емес» деген жауапты естісең, не айтатыныңды жаз.',
        notes: 'Екі минут беріңіз. Сөйлемдерді бағалағанда көмектің нақты ұсынылғанын және сыныптасының жауабы қабылданғанын тексеріңіз. Келесі сабақтың басында оқушы есімдерін атамай, бір-екі мысал оқыңыз.',
      },
    ],
  },
  {
    key: 'kindness',
    language: 'ru',
    theme: 'steppe',
    template: 'meeting',
    topic: 'Как помочь однокласснику',
    sourceText: 'На классном часе ученики учатся предлагать помощь и уважать ответ одноклассника. Три шага: заметь, что происходит, предложи конкретную помощь и дождись ответа. На одной иллюстрации мальчик сидит на скамейке, пока другие дети играют в мяч. Можно пригласить его в игру. На другой иллюстрации двое ребят собирают тетради в школьном коридоре. Вопрос «Помочь собрать тетради?» оставляет право выбора. В парной сценке один ученик не понял первый шаг задания, а второй предлагает прочитать его вместе. Если одноклассник говорит «Спасибо, я сначала попробую сам», можно ответить «Хорошо. Если понадобится помощь, скажи». В конце урока каждый записывает один вопрос с предложением помощи и свой ответ на вежливый отказ.',
    slides: [
      {
        layout: 'cover', lessonPart: 'goal',
        title: 'Как помочь однокласснику',
        body: 'Потренируемся предлагать помощь и уважать ответ собеседника.',
        notes: 'Попросите учеников назвать две детали иллюстрации, которые они видят. Затем предложите им придумать первую реплику девочки. На обсуждение достаточно минуты.',
        image: illustration('kindness-schoolyard', 'Во дворе школы девочка протягивает руку мальчику на скамейке.'),
      },
      {
        layout: 'image-right', lessonPart: 'new-material',
        title: 'Заметь, спроси, выслушай',
        body: 'Тетради упали на пол. Спроси «Помочь собрать тетради?» и дождись ответа.',
        notes: 'Покажите короткую паузу после вопроса. Попросите двух учеников ответить по-разному. Например, «Да, подними эти две» и «Спасибо, я сам». Обсудите, что делать в каждом случае.',
        image: illustration('kindness-notebooks', 'Двое учеников поднимают тетради с пола в школьном коридоре.'),
      },
      {
        layout: 'image-grid', lessonPart: 'example',
        title: 'Что сказать в каждой ситуации?',
        body: 'Во дворе — «Хочешь сыграть с нами?»\nВ коридоре — «Помочь собрать тетради?»',
        notes: 'Пусть пары назовут по одному действию на каждой картинке, а затем придумают свой вопрос. Попросите объяснить, какой выбор остаётся у того, кому адресован вопрос.',
        image: illustration('kindness-schoolyard', 'Во дворе мальчик сидит на скамейке, пока другие дети играют в мяч.'),
        additionalImages: [illustration('kindness-notebooks', 'В коридоре двое учеников собирают тетради с пола.')],
      },
      {
        layout: 'stacked', lessonPart: 'practice',
        title: 'Разыграйте диалог в паре',
        body: 'Одноклассник не понял первый шаг задания. Предложите прочитать его вместе и выслушайте ответ. Поменяйтесь ролями и на этот раз вежливо откажитесь от помощи.',
        notes: 'Дайте по минуте на каждый раунд. В конце предложите парам проверить две вещи: прозвучало ли конкретное предложение и дали ли собеседнику время ответить.',
      },
      {
        layout: 'centered', lessonPart: 'check',
        title: '«Спасибо, я сначала попробую сам»',
        body: 'Как ответить?\nА. «Дай сюда, я сделаю быстрее».\nБ. «Хорошо. Если понадобится помощь, скажи».\nВ. «Нет, я всё равно помогу».',
        answer: 'Б. Так ты уважаешь решение одноклассника и оставляешь ему возможность попросить о помощи позже.',
        notes: 'Перед открытием ответа попросите каждого выбрать вариант самостоятельно. Предложите ученику объяснить, что происходит с выбором одноклассника в двух других вариантах.',
      },
      {
        layout: 'body', lessonPart: 'summary',
        title: 'Напиши две реплики',
        body: 'Запиши один вопрос, которым можно предложить помощь. Следом запиши, как ответишь, если услышишь «Пока не надо».',
        notes: 'Дайте две минуты. Проверьте, что помощь сформулирована конкретно, а ответ на отказ звучит спокойно. Начните следующий урок с одного-двух примеров без имён авторов.',
      },
    ],
  },
  {
    key: 'kindness',
    language: 'en',
    theme: 'steppe',
    template: 'meeting',
    topic: 'How to help a classmate',
    sourceText: 'In this class meeting, students practise offering help and respecting the answer. The three steps are to notice what is happening, offer something specific, and wait for a reply. In one picture, a boy is on a bench while other children play ball in the schoolyard. A classmate could invite him to play. In the other picture, two children are picking up notebooks in the hall. Asking “Would you like help picking those up?” gives a classmate a choice. In the pair exercise, one student is unsure about the first step of an assignment and the other offers to read it with them. If the student says “Thanks, I want to try on my own first,” one respectful reply is “Okay. Let me know if you need help.” Each student finishes the lesson by writing one offer of help and one reply to “Not right now.”',
    slides: [
      {
        layout: 'cover', lessonPart: 'goal',
        title: 'How to help a classmate',
        body: 'Practise offering help and respecting the answer.',
        notes: 'Ask students for two things they can see in the illustration. Then ask them to suggest what the girl might say first. Allow about a minute for the discussion.',
        image: illustration('kindness-schoolyard', 'A girl in the schoolyard holds out a hand to a boy on a bench.'),
      },
      {
        layout: 'image-right', lessonPart: 'new-material',
        title: 'Notice, ask, listen',
        body: 'Some notebooks fell on the floor. Ask, “Would you like help picking those up?” Wait for an answer.',
        notes: 'Model pausing after you ask. Have two students try different answers, such as “Yes, please pick up those two” and “Thanks, I’ve got it.” Discuss how each answer changes what you do next.',
        image: illustration('kindness-notebooks', 'Two students pick up notebooks from the floor in a school hallway.'),
      },
      {
        layout: 'image-grid', lessonPart: 'example',
        title: 'What could you say in each scene?',
        body: 'Schoolyard — “Would you like to play with us?”\nHallway — “Would you like help picking those up?”',
        notes: 'Have pairs name one action in each picture, then make up a question that fits the scene. Ask them to explain what choice the classmate gets to make.',
        image: illustration('kindness-schoolyard', 'A boy sits on a schoolyard bench while other students play ball.'),
        additionalImages: [illustration('kindness-notebooks', 'Two students pick up notebooks in the hallway.')],
      },
      {
        layout: 'stacked', lessonPart: 'practice',
        title: 'Act it out in pairs',
        body: 'A classmate is unsure about the first step of a task. Offer to read it together and listen to the reply. Switch roles and this time politely decline the offer.',
        notes: 'Give pairs one minute per round. At the end, ask them to check whether the offer was specific and whether both partners had time to finish their reply.',
      },
      {
        layout: 'centered', lessonPart: 'check',
        title: '“Thanks, I want to try on my own first”',
        body: 'What could you say?\nA. “Give it here. I can do it faster.”\nB. “Okay. Let me know if you need help.”\nC. “No, I’m going to help anyway.”',
        answer: 'B. It respects your classmate’s choice and leaves them free to ask for help later.',
        notes: 'Before revealing the answer, have everyone choose an option on their own. Ask one student to explain what happens to the classmate’s choice in the other two replies.',
      },
      {
        layout: 'body', lessonPart: 'summary',
        title: 'Write two lines',
        body: 'Write a question that offers help. Then write what you could say if you hear “Not right now.”',
        notes: 'Give students two minutes. Check that each offer is specific and the reply accepts the answer. Open the next lesson by sharing one or two examples without naming their authors.',
      },
    ],
  },
];

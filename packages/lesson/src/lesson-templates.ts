import type { Locale, Theme } from './types';

// The tuple order matches the three authored editions of each lesson move.
const tr = (en:string,ru:string,kk:string) => ({en,ru,kk});
type Text = ReturnType<typeof tr>;
const stage = (title:Text,task:Text) => ({title,task});
const stages = {
  open:stage(tr('Lesson question','Вопрос урока','Сабақ сұрағы'),tr('What do we already know, and what would we like to find out?','Что мы уже знаем и что хотим выяснить?','Не білеміз және нені білгіміз келеді?')),
  predict:stage(tr('Make a prediction','Выдвигаем гипотезу','Болжам жасау'),tr('Predict the result and give a reason before collecting evidence.','Спрогнозируйте результат и обоснуйте его до сбора данных.','Дерек жинамас бұрын нәтижені болжап, себебін түсіндіріңіз.')),
  measure:stage(tr('Plan the measurements','План измерений','Өлшеу жоспары'),tr('Choose the unit, instrument and conditions to keep constant.','Выберите единицу, прибор и условия, которые сохранятся.','Өлшем бірлігін, құралды және тұрақты болатын шарттарды таңдаңыз.')),
  record:stage(tr('Record observations','Фиксируем наблюдения','Бақылауды жазу'),tr('Make a record with labels so a classmate can interpret it.','Подпишите наблюдения так, чтобы их понял одноклассник.','Сыныптасыңыз түсіне алатындай бақылау нәтижелерін белгілеңіз.')),
  compare:stage(tr('Compare two cases','Сравниваем два случая','Екі мысалды салыстыру'),tr('Use one shared criterion and identify a meaningful difference.','Выберите общий критерий и найдите существенное различие.','Ортақ өлшемді таңдап, маңызды айырмашылықты анықтаңыз.')),
  define:stage(tr('Build a definition','Формулируем определение','Анықтама құрастыру'),tr('Identify the essential feature and explain it in your own words.','Выделите главный признак и объясните его своими словами.','Негізгі белгіні анықтап, өз сөзіңізбен түсіндіріңіз.')),
  model:stage(tr('Study a worked example','Разбираем образец','Үлгіні талдау'),tr('Inspect the reasoning at each step. Which step needs an explanation?','Проследите ход рассуждения. Какой шаг нужно пояснить?','Әр қадамдағы ойды бақылаңыз. Қай қадамға түсініктеме қажет?')),
  apply:stage(tr('Try a new case','Применяем на новом примере','Жаңа мысалға қолдану'),tr('Use the same idea in a new case and explain your choice.','Примените идею в новой ситуации и объясните свой выбор.','Идеяны жаңа жағдайға қолданып, таңдауыңызды түсіндіріңіз.')),
  recall:stage(tr('Recall from memory','Вспоминаем без подсказки','Жадтан еске түсіру'),tr('Close your notes and write what you remember. Mark uncertainties.','Закройте записи и запишите, что помните. Отметьте сомнения.','Жазбаны жауып, есте қалғанын жазыңыз. Күмәнді жерді белгілеңіз.')),
  diagnose:stage(tr('Find the error','Находим ошибку','Қатені табу'),tr('Locate the first unsupported step and explain its effect.','Найдите первый необоснованный шаг и объясните его последствия.','Алғашқы негізсіз қадамды тауып, оның әсерін түсіндіріңіз.')),
  criteria:stage(tr('Set success criteria','Определяем критерии успеха','Табыс өлшемдерін анықтау'),tr('Describe observable features of a strong response.','Назовите наблюдаемые признаки качественного ответа.','Сапалы жауаптың байқауға болатын белгілерін атаңыз.')),
  perform:stage(tr('Independent task','Самостоятельная работа','Өзіндік жұмыс'),tr('Complete the task independently and keep a record of your reasoning.','Выполните задание самостоятельно и запишите ход рассуждений.','Тапсырманы өз бетіңізше орындап, ойлау жолын жазыңыз.')),
  check:stage(tr('Check against criteria','Сверяемся с критериями','Өлшемдермен салыстыру'),tr('Check each criterion and identify one revision you can justify.','Сверьте работу с каждым критерием и обоснуйте одну правку.','Жұмысты әр өлшеммен салыстырып, бір өзгерісті негіздеңіз.')),
  listen:stage(tr('Hear different viewpoints','Слушаем разные мнения','Әртүрлі пікірді тыңдау'),tr('Restate another person’s viewpoint before giving your own.','Перед своим ответом перескажите позицию другого участника.','Өз пікіріңізді айтпас бұрын өзгенің ойын жеткізіңіз.')),
  decide:stage(tr('Agree on an action','Договариваемся о действии','Ортақ шешімге келу'),tr('Choose an action and specify who will follow up and when.','Выберите действие и договоритесь, кто и когда проверит результат.','Әрекетті таңдап, нәтижені кім және қашан тексеретінін келісіңіз.')),
  claim:stage(tr('State your claim','Формулируем тезис','Тұжырым ұсыну'),tr('Write a claim a classmate could support or challenge.','Запишите тезис, который можно подтвердить или оспорить.','Дәлелдеуге немесе даулауға болатын тұжырым жазыңыз.')),
  evidence:stage(tr('Select evidence','Подбираем доказательство','Дәлел таңдау'),tr('Choose evidence and explain exactly how it supports the claim.','Выберите доказательство и объясните его связь с тезисом.','Дәлел таңдап, оның тұжырымды қалай қолдайтынын түсіндіріңіз.')),
  defend:stage(tr('Respond to a challenge','Отвечаем на возражение','Қарсы пікірге жауап'),tr('Answer one difficult question using the evidence you presented.','Ответьте на сложный вопрос с опорой на представленные доказательства.','Келтірген дәлеліңізге сүйеніп, бір күрделі сұраққа жауап беріңіз.')),
  annotate:stage(tr('Annotate the passage','Делаем пометки в тексте','Мәтінге белгі қою'),tr('Underline a telling detail and add a question in the margin.','Подчеркните значимую деталь и запишите на полях вопрос.','Маңызды тұстың астын сызып, мәтін шетіне сұрақ жазыңыз.')),
  draft:stage(tr('Create a first draft','Готовим черновик','Алғашқы нұсқа жазу'),tr('Draft a response for a specific reader and purpose.','Подготовьте черновик для конкретного читателя с ясной целью.','Белгілі оқырман мен мақсатқа арналған алғашқы нұсқаны жазыңыз.')),
  peer:stage(tr('Exchange feedback','Обмениваемся отзывами','Кері байланыс алмасу'),tr('Point to one effective detail and suggest one specific improvement.','Укажите удачную деталь и предложите конкретное улучшение.','Бір сәтті тұсты көрсетіп, нақты жақсарту ұсыныңыз.')),
  revise:stage(tr('Revise and explain','Дорабатываем ответ','Жауапты жетілдіру'),tr('Revise one part and explain what the new version improves.','Измените одну часть и объясните, чем новая версия лучше.','Бір бөлігін өзгертіп, жаңа нұсқаның нені жақсартқанын түсіндіріңіз.')),
  classify:stage(tr('Sort and label','Группируем и подписываем','Топтау және атау'),tr('Sort examples into groups, name each group and explain a borderline case.','Объедините примеры в группы, назовите их и разберите спорный пример.','Мысалдарды топтап, әр топты атаңыз. Бір даулы мысалды түсіндіріңіз.')),
  source:stage(tr('Identify the source','Определяем источник','Дереккөзді анықтау'),tr('Identify the author, audience and purpose. Note what is unknown.','Определите автора, адресата и цель. Отметьте, что неизвестно.','Авторды, оқырманды және мақсатты анықтаңыз. Белгісіз тұстарын жазыңыз.')),
  order:stage(tr('Build the sequence','Выстраиваем последовательность','Ретін құрастыру'),tr('Arrange the events in order and justify one link between them.','Расположите события по порядку и обоснуйте связь между двумя из них.','Оқиғаларды ретімен қойып, екеуінің байланысын негіздеңіз.')),
  prove:stage(tr('Construct a proof','Строим доказательство','Дәлелдеу жолын құру'),tr('Link the givens to the conclusion. Justify every inference.','Свяжите условия с выводом. Обоснуйте каждый переход.','Берілген шарттарды қорытындымен байланыстырып, әр қадамды негіздеңіз.')),
  represent:stage(tr('Choose a representation','Выбираем представление','Көрсету тәсілін таңдау'),tr('Sketch a diagram, table or model and label what each element represents.','Сделайте схему, таблицу или модель и подпишите элементы.','Сызба, кесте немесе модель жасап, бөліктерін белгілеңіз.')),
  design:stage(tr('Design a prototype','Проектируем прототип','Алғашқы үлгі жасау'),tr('Sketch a solution with its constraints and a test for success.','Наметьте решение, ограничения и способ проверить результат.','Шешімді сызбаға түсіріп, шектеулер мен тексеру тәсілін көрсетіңіз.')),
  test:stage(tr('Test and inspect','Испытываем и наблюдаем','Сынау және бақылау'),tr('Run a test, record what happened and compare it with the prediction.','Проведите испытание, запишите результат и сравните с прогнозом.','Сынақ өткізіп, нәтижені жазып, болжаммен салыстырыңыз.')),
  observe:stage(tr('Observe closely','Наблюдаем внимательно','Мұқият бақылау'),tr('Describe what you can see or hear before interpreting it.','Опишите, что видите или слышите, прежде чем толковать наблюдение.','Түсіндірмес бұрын көргеніңізді немесе естігеніңізді сипаттаңыз.')),
  exit:stage(tr('Exit question','Итоговый вопрос','Қорытынды сұрақ'),tr('Which finding can you defend, and what question is still open?','Какой вывод вы можете обосновать и какой вопрос остаётся открытым?','Қай тұжырымды негіздей аласыз және қандай сұрақ ашық қалды?')),
};
type Step = keyof typeof stages;
export const templateSubjects = {
  science:tr('Science','Естествознание','Жаратылыстану'), general:tr('Cross-subject','Межпредметные','Пәнаралық'),
  humanities:tr('Humanities','Общественные науки','Қоғамдық ғылымдар'), language:tr('Languages and literature','Языки и литература','Тіл және әдебиет'),
  maths:tr('Mathematics','Математика','Математика'), technology:tr('Technology','Технология','Технология'), arts:tr('Arts','Искусство','Өнер'),
};
const template = (name:Text, topic:Text, scenario:Text, subject:keyof typeof templateSubjects, min:number, max:number, theme:Theme, steps:Step[])=>({name,topic,scenario,subject,min,max,theme,steps});
export const lessonTemplates = {
  measurement: template(
    tr('Practical investigation','Практическое исследование','Тәжірибелік зерттеу'),
    tr('Comparing water volumes','Сравниваем объёмы воды','Су көлемдерін салыстыру'),
    tr('Measure water in three containers using the same unit. Explain the differences in your records.','Измерьте воду в трёх сосудах в одних единицах. Объясните различия в записях.','Үш ыдыстағы суды бірдей бірлікпен өлшеңіз. Жазбадағы айырмашылықты түсіндіріңіз.'),
    'science',3,11,'blueprint',['predict','measure','record','compare','evidence'],
  ),
  explain: template(
    tr('Explain a new topic','Объяснение новой темы','Жаңа тақырыпты түсіндіру'),
    tr('How does a seed grow?','Как растёт семя?','Тұқым қалай өседі?'),
    tr('Look at a bean seedling. Identify its first root and explain how that root helps it grow.','Рассмотрите проросток фасоли. Найдите первый корешок и объясните его роль в росте.','Үрмебұршақ өскінін қараңыз. Алғашқы тамыршасын тауып, оның өсуге қалай көмектесетінін түсіндіріңіз.'),
    'general',1,11,'atlas',['observe','define','model','apply','check'],
  ),
  revise: template(
    tr('Review a unit','Повторение раздела','Бөлімді қайталау'),
    tr('What makes a triangle?','Как узнать треугольник?','Үшбұрышты қалай ажыратамыз?'),
    tr('Draw three different triangles from memory. Test whether a figure with one curved edge belongs in the group.','Нарисуйте по памяти три разных треугольника. Может ли к ним относиться фигура с кривой стороной?','Есте қалған үш түрлі үшбұрышты сызыңыз. Бір қабырғасы қисық фигура осы топқа кіре ме?'),
    'general',1,11,'midnight',['recall','classify','diagnose','apply','check'],
  ),
  assessment: template(
    tr('Independent assessment','Контрольная работа','Бақылау жұмысы'),
    tr('Reading a coordinate grid','Читаем координатную сетку','Координаталық торды оқу'),
    tr('Mark two points on a grid. Write directions a partner can use to find both without seeing your drawing.','Отметьте две точки на сетке. Напишите указания, по которым напарник найдёт их без вашего рисунка.','Торда екі нүктені белгілеңіз. Серіктесіңіз сызбаңызға қарамай таба алатындай нұсқау жазыңыз.'),
    'general',3,11,'minimal',['criteria','model','perform','check','diagnose'],
  ),
  meeting: template(
    tr('Class meeting','Классный час','Сынып сағаты'),
    tr('Sharing the class reading corner','Пользуемся классным уголком чтения','Сыныптағы оқу бұрышын бірге пайдалану'),
    tr('Two groups want to use the same reading corner. Hear both groups and agree on a timetable to try.','Две группы хотят одновременно пользоваться уголком чтения. Выслушайте их и согласуйте пробное расписание.','Екі топ оқу бұрышын бір мезгілде қолданғысы келеді. Екі жақты тыңдап, сынақ кестесін келісіңіз.'),
    'general',1,11,'steppe',['listen','compare','decide','peer','check'],
  ),
  defense: template(
    tr('Project defence','Защита проекта','Жобаны қорғау'),
    tr('A quieter school corridor','Как сделать школьный коридор тише','Мектеп дәлізіндегі шуды азайту'),
    tr('Present one design change, a sketch and an observation that supports it. Invite a question about a limitation.','Представьте одно изменение, эскиз и подтверждающее наблюдение. Предложите задать вопрос об ограничениях.','Бір өзгеріс, сызба және оны қолдайтын бақылау ұсыныңыз. Шектеуі туралы сұраққа жауап беріңіз.'),
    'general',5,11,'editorial',['claim','design','evidence','defend','revise'],
  ),
  reading: template(
    tr('Close reading','Внимательное чтение','Мәтінді мұқият оқу'),
    tr('How a narrator builds suspense','Как рассказчик создаёт напряжение','Баяндаушы шиеленісті қалай жасайды?'),
    tr('Read a short passage twice. Mark a detail that changes your expectations and quote it in your interpretation.','Прочитайте отрывок дважды. Отметьте деталь, меняющую ожидания, и процитируйте её в толковании.','Үзіндіні екі рет оқыңыз. Болжамыңызды өзгерткен детальді белгілеп, талдауда дәйексөз келтіріңіз.'),
    'language',4,11,'newsprint',['observe','annotate','claim','evidence','defend'],
  ),
  writing: template(
    tr('Writing workshop','Писательская мастерская','Жазылым шеберханасы'),
    tr('A letter to the school council','Письмо школьному совету','Мектеп кеңесіне хат'),
    tr('Draft a letter proposing a class event. Ask a reader to mark the request and one detail that needs clarification.','Напишите черновик письма о классном мероприятии. Попросите читателя выделить просьбу и неясную деталь.','Сынып шарасы туралы хат нобайын жазыңыз. Оқырманнан өтініш пен түсініксіз тұсты белгілеуін сұраңыз.'),
    'language',3,11,'notebook',['criteria','model','draft','peer','revise'],
  ),
  vocabulary: template(
    tr('Vocabulary in context','Лексика в контексте','Сөзді мәнмәтінде меңгеру'),
    tr('Verbs in a weather report','Глаголы в прогнозе погоды','Ауа райы болжамындағы етістіктер'),
    tr('Collect verbs from a forecast. Sort them by meaning and use two in a new report for tomorrow.','Выпишите глаголы из прогноза. Сгруппируйте их по значению и используйте два в прогнозе на завтра.','Болжамнан етістіктерді теріп жазыңыз. Мағынасына қарай топтап, екеуін ертеңгі болжамда қолданыңыз.'),
    'language',2,9,'chalkboard',['annotate','classify','define','apply','recall'],
  ),
  debate: template(
    tr('Evidence-based debate','Дебаты с аргументами','Дәлелді пікірсайыс'),
    tr('Should the school day start later?','Стоит ли начинать школьный день позже?','Сабақ кешірек басталуы керек пе?'),
    tr('Assign two positions. Each side makes a claim, cites a source and responds to the strongest objection.','Распределите две позиции. Каждая сторона выдвигает тезис, ссылается на источник и отвечает на главное возражение.','Екі ұстанымды бөлісіңіз. Әр жақ тұжырым айтып, дерек келтіріп, басты қарсы пікірге жауап береді.'),
    'humanities',6,11,'contrast',['claim','source','evidence','listen','defend'],
  ),
  archive: template(
    tr('Historical source inquiry','Анализ исторического источника','Тарихи деректі талдау'),
    tr('What can a family photograph tell us?','О чём рассказывает семейная фотография?','Отбасылық фотосурет не айта алады?'),
    tr('Inspect a public archival photograph. Separate visible details from assumptions and identify one missing piece of context.','Изучите открытую архивную фотографию. Отделите видимые детали от предположений и назовите недостающие сведения.','Ашық мұрағат фотосын қараңыз. Көрінетін детальді болжамнан ажыратып, жетіспейтін мәліметті атаңыз.'),
    'humanities',5,11,'museum',['source','observe','annotate','evidence','defend'],
  ),
  chronology: template(
    tr('Chronology and cause','Хронология и причины','Хронология және себеп'),
    tr('How did our neighbourhood change?','Как менялся наш район?','Біздің аудан қалай өзгерді?'),
    tr('Arrange dated local photographs on a timeline. Explain a change and distinguish its evidence from a possible cause.','Расположите датированные снимки района на шкале времени. Объясните изменение и отделите факт от возможной причины.','Ауданның күні көрсетілген фотоларын уақыт сызығына қойыңыз. Өзгерісті түсіндіріп, дерек пен ықтимал себепті ажыратыңыз.'),
    'humanities',4,11,'atlas',['source','order','compare','claim','evidence'],
  ),
  proof: template(
    tr('Mathematical proof','Математическое доказательство','Математикалық дәлелдеу'),
    tr('Why is the sum of two odd numbers even?','Почему сумма двух нечётных чисел чётна?','Екі тақ санның қосындысы неге жұп?'),
    tr('Build pairs of counters for two odd groups. Use the leftover counters to explain the general result.','Разбейте фишки двух нечётных групп на пары. Объясните общий результат с помощью оставшихся фишек.','Екі тақ топтағы тастарды жұптаңыз. Артық қалған тастар арқылы жалпы нәтижені түсіндіріңіз.'),
    'maths',5,11,'blueprint',['predict','represent','claim','prove','defend'],
  ),
  problem: template(
    tr('Problem-solving clinic','Практикум решения задач','Есеп шығару практикумы'),
    tr('Two paths around a garden','Два маршрута вокруг сада','Бақты айналатын екі жол'),
    tr('Draw the garden paths and label the known lengths. Compare two strategies for finding the shorter route.','Начертите дорожки и подпишите известные длины. Сравните два способа определить короткий маршрут.','Жолдарды сызып, белгілі ұзындықтарды жазыңыз. Қысқа жолды табудың екі тәсілін салыстырыңыз.'),
    'maths',2,11,'notebook',['represent','predict','model','perform','compare'],
  ),
  statistics: template(
    tr('Data investigation','Исследуем данные','Деректерді зерттеу'),
    tr('How do classmates travel to school?','Как ученики добираются до школы?','Оқушылар мектепке қалай келеді?'),
    tr('Collect anonymous travel modes, tally categories and choose a chart that answers the class question.','Анонимно соберите способы передвижения, подсчитайте категории и выберите диаграмму для ответа на вопрос.','Аты-жөнсіз қатынау тәсілдерін жинап, топтар бойынша санаңыз. Сұраққа жауап беретін диаграмманы таңдаңыз.'),
    'maths',3,11,'laboratory',['predict','record','classify','represent','evidence'],
  ),
  fieldwork: template(
    tr('Field observation','Полевое наблюдение','Далалық бақылау'),
    tr('Where do lichens grow?','Где растут лишайники?','Қыналар қай жерде өседі?'),
    tr('Observe two tree trunks without disturbing them. Sketch where lichens occur and compare the sites.','Осмотрите два ствола, не повреждая их. Зарисуйте расположение лишайников и сравните места.','Екі ағаш діңін зақымдамай бақылаңыз. Қыналардың орналасуын сызып, орындарды салыстырыңыз.'),
    'science',3,11,'steppe',['observe','record','represent','compare','claim'],
  ),
  engineering: template(
    tr('Engineering design challenge','Инженерная задача','Инженерлік жобалау'),
    tr('A bridge made from paper','Мост из бумаги','Қағаз көпір'),
    tr('Design a paper bridge for a fixed span. Test its load, change one fold and compare the result.','Спроектируйте бумажный мост заданного пролёта. Испытайте нагрузку, измените один сгиб и сравните результат.','Белгіленген аралыққа қағаз көпір жобалаңыз. Жүктемені сынап, бір бүктемесін өзгертіп, нәтижені салыстырыңыз.'),
    'technology',3,11,'blueprint',['criteria','design','test','diagnose','revise'],
  ),
  debugging: template(
    tr('Debug an algorithm','Отладка алгоритма','Алгоритмді түзету'),
    tr('Why does the robot miss its square?','Почему робот не замыкает квадрат?','Робот шаршыны неге аяқтамайды?'),
    tr('Trace a short drawing algorithm on paper. Locate the first wrong turn and retest a single change.','Проследите на бумаге команды рисования. Найдите первый неверный поворот и проверьте одну правку.','Сызу алгоритмін қағазда орындаңыз. Алғашқы қате бұрылысты тауып, бір түзетуді тексеріңіз.'),
    'technology',4,11,'midnight',['predict','order','test','diagnose','revise'],
  ),
  critique: template(
    tr('Art critique','Обсуждение художественной работы','Көркем жұмысты талқылау'),
    tr('Where does a poster draw your eye?','Что первым привлекает взгляд на плакате?','Плакатта көзіңіз алдымен неге түседі?'),
    tr('Trace the path your eye takes through a poster. Identify a contrast that guides it and suggest one change.','Проследите путь взгляда по плакату. Назовите контраст, который его направляет, и предложите правку.','Плакатты қарағандағы көз қозғалысын белгілеңіз. Оған әсер еткен контрастты атап, бір өзгеріс ұсыныңыз.'),
    'arts',2,11,'museum',['observe','annotate','compare','peer','revise'],
  ),
  music: template(
    tr('Listening and rhythm','Слушание и ритм','Тыңдау және ырғақ'),
    tr('How does a repeated rhythm change?','Как меняется повторяющийся ритм?','Қайталанатын ырғақ қалай өзгереді?'),
    tr('Clap a short pattern twice. Change one beat, then ask a partner to identify and reproduce the change.','Дважды прохлопайте короткий рисунок. Измените одну долю и попросите напарника воспроизвести изменение.','Қысқа ырғақты екі рет шапалақтаңыз. Бір соққыны өзгертіп, серіктесіңізден өзгерісті қайталауын сұраңыз.'),
    'arts',1,8,'editorial',['listen','record','compare','perform','peer'],
  ),
};
export type TemplateId = keyof typeof lessonTemplates;
export const templateIds = Object.keys(lessonTemplates) as TemplateId[];
export function isTemplate(id:unknown):id is TemplateId {
  return typeof id==='string' && Object.hasOwn(lessonTemplates,id);
}

export function templatePlan(id:TemplateId,locale:Locale,topic:string,count:number) {
  const preset=lessonTemplates[id];
  const extras:Step[]=['apply','peer','check','model','recall','evidence','revise','compare'];
  const choices=[...new Set([...preset.steps,...extras])];
  const inner=count-2;
  const steps:Step[]=['open'];
  for(let i=0;i<inner;i++) {
    const position=inner<preset.steps.length && inner>1 ? Math.round(i*(preset.steps.length-1)/(inner-1)) : i;
    steps.push(choices[position%choices.length]);
  }
  if (count>1) steps.push('exit');
  return steps.map((key,i)=>{
    const move=stages[key];
    const previous=steps.slice(0,i).filter(other=>other===key).length;
    const title=i===0 ? topic : move.title[locale]+(previous ? ' · '+(previous+1) : '');
    const task=i===0 && topic===preset.topic[locale] ? preset.scenario[locale] : move.task[locale];
    return {title,summary:task,purpose:task,section:move.title[locale],layout:i===0 ? 'cover' as const : 'body' as const};
  });
}

export function matchingTemplates(subject?:string,grade?:number) {
  return templateIds.filter(id=>{
    const preset=lessonTemplates[id];
    return (!subject || preset.subject===subject) && (grade===undefined || grade>=preset.min && grade<=preset.max);
  });
}

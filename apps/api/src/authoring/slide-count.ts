import { isTemplate, lessonTemplates } from '@sabaq/lesson/lesson-templates';
import { maxLessonSlides, minGeneratedSlides, type CreateInput } from '@sabaq/lesson/types';
import { ApiError } from '../errors';

const limit = (value: number) => Math.min(maxLessonSlides, Math.max(minGeneratedSlides, value));
const minutesInText = /(\d+(?:[.,]\d+)?)\s*[-–]?\s*(?:min(?:ute)?s?\b|минут[\p{L}]*|мин(?![\p{L}]))/iu;

function countForMinutes(minutes: number) {
  // Keep the established 10-, 20- and 45-minute lesson sizes, interpolating other durations.
  if (minutes <= 10) return limit(Math.round(minutes / 2));
  if (minutes <= 20) return 5 + Math.round((minutes - 10) / 5);
  return limit(7 + Math.round((minutes - 20) * 3 / 25));
}

function sectionCount(text: string) {
  return text.split(/\r?\n/u).filter(line => /^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s)/u.test(line)).length;
}

export function plannedLessonMinutes(input:Pick<CreateInput,'topic'|'answers'>) {
  const duration=input.answers?.duration?.trim() ?? '';
  const value=/^\d+(?:[.,]\d+)?$/u.test(duration) ? duration : duration.match(minutesInText)?.[1] ?? input.topic.match(minutesInText)?.[1];
  const minutes=Number(value?.replace(',','.'));
  return Number.isFinite(minutes) && minutes>0 && minutes<Number.MAX_SAFE_INTEGER/60 ? minutes : undefined;
}

/** Legacy fixture research with no length instruction uses one slide per retrieved source. */
export function slideCountFor(input: CreateInput): number | undefined {
  if (input.template === 'blank' && input.slideCount === undefined) return 1;
  const fromTopic = input.topic.match(/(?<![\p{L}\d.,])(\d+)\s*[-–]?\s*(?:slides?\b|слайд[\p{L}]*)/iu);
  const exact = input.slideCount ?? (fromTopic ? Number(fromTopic[1]) : undefined);
  if (exact !== undefined) {
    const minimum = input.template === 'blank' ? 1 : minGeneratedSlides;
    if (!Number.isInteger(exact) || exact < minimum || exact > maxLessonSlides)
      throw new ApiError(400, `Choose a slide count between ${minimum} and ${maxLessonSlides}.`);
    return exact;
  }
  const minutes=plannedLessonMinutes(input);
  if (minutes) return countForMinutes(minutes);
  if (input.researchQuery) return undefined;

  const detail = /(?:in.depth|comprehensive|detailed|подробн|углубл|егжей|терең)/iu.test(input.topic) ? 2 :
    /(?:brief overview|quick overview|short intro|кратк|қысқаша)/iu.test(input.topic) ? -2 : 0;
  const level = input.answers?.level || input.topic;
  const audience = /(?:adult|university|undergraduate|университет|взросл|студент|ересек)/iu.test(level) ? 1 :
    /(?:^middle$|elementary|primary school|beginners|начальн[\p{L}]* класс|бастауыш)/iu.test(level) ? -1 : 0;
  const topicSections = sectionCount(input.topic);
  let teachingSteps = isTemplate(input.template) ? lessonTemplates[input.template].steps.length : 5;
  if (topicSections > 1) teachingSteps = topicSections;
  else if (!isTemplate(input.template)) {
    const instructions = input.topic.split(/[;\n]|[.!?]\s+/u).filter(part => part.trim());
    teachingSteps += Math.min(4, Math.max(0, instructions.length - 1));
  }
  if (input.source) {
    const text = input.source.text;
    const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    const paragraphs = text.trim().split(/\r?\n\s*\r?\n/u).length;
    const sourceSteps = Math.max(1, sectionCount(text), paragraphs, Math.ceil(wordCount / 110));
    teachingSteps = Math.max(sourceSteps, topicSections, isTemplate(input.template) ? teachingSteps : 1);
  }
  // Allow space for the opening and conclusion around the material to teach.
  return limit(2 + teachingSteps + detail + audience);
}

import { diagramNames } from './diagram';
import { maxLessonSlides, type Deck, type EditOp, type Slide, type SlideChanges } from './types';

export type AssistantOperation =
  | Exclude<EditOp, {kind: 'slide' | 'outline' | 'add' | 'duplicate' | 'remove' | 'copySlides' | 'removeSlides'}>
  | {kind: 'slide'; slideId: string; changes: SlideChanges; clear?: ('image' | 'design' | 'answer' | 'chart' | 'table')[]}
  | {kind: 'add'; afterId?: string; content?: SlideChanges; newSlideId?: string}
  | {kind: 'duplicate'; slideId: string; newSlideId?: string}
  | {kind: 'remove'; slideId: string};

export type LessonEdit = EditOp | Extract<AssistantOperation, { kind: 'add' | 'duplicate' }>;

export class LessonEditError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'invalid', message: string) {
    super(message);
  }
}

function getSlide(deck: Deck, id: string) {
  const slide = deck.slides.find(item => item.id === id);
  if (!slide) throw new LessonEditError('not-found', 'Slide not found.');
  return slide;
}

export function applyLessonEdit(
  lesson: Deck,
  op: LessonEdit,
  { outlineRunActive = false, newId, copySource }: { outlineRunActive?: boolean; newId: () => string; copySource?:Deck },
) {
  if (op.kind === 'slide') {
    const slide = getSlide(lesson, op.slideId);
    if (slide.status !== 'ready' || slide.version !== op.baseVersion)
      throw new LessonEditError('conflict', 'Slide version changed.');
    const changes = op.changes;
    const templateLayout=changes.powerPointLayoutId && lesson.powerPointStyle?.layouts.find(layout=>layout.id===changes.powerPointLayoutId);
    if (changes.powerPointLayoutId && (!templateLayout || changes.layout && changes.layout!==templateLayout.layout))
      throw new LessonEditError('invalid','Choose a layout from this presentation’s PowerPoint design.');
    const additionalImages=changes.additionalImages ?? slide.additionalImages;
    if (additionalImages?.length && (!(changes.image || slide.image) || slide.importedPage ||
        changes.chart || changes.table || changes.diagram || slide.chart || slide.table || slide.diagram)) {
      throw new LessonEditError('invalid', 'Use an image grid on a slide without an import, chart, table, or diagram.');
    }
    if ((changes.diagram || slide.diagram) && (changes.image || changes.chart || changes.table ||
        (changes.diagram && (slide.image || slide.chart || slide.table || slide.design)))) {
      throw new LessonEditError('invalid', 'Add the diagram on a separate slide.');
    }
    if (changes.body !== undefined && changes.body !== slide.body) {
      if (!changes.bodyRuns) delete slide.bodyRuns;
      if (!changes.richText?.body && slide.richText) delete slide.richText.body;
    }
    if (changes.title !== undefined && changes.title !== slide.title && !changes.richText?.title && slide.richText)
      delete slide.richText.title;
    Object.assign(slide, changes);
    if (templateLayout) slide.layout=templateLayout.layout;
    else if (changes.layout || changes.powerPointLayoutId===null) delete slide.powerPointLayoutId;
    slide.version++;
  } else if (op.kind === 'deck') {
    if (op.title !== undefined) lesson.title = op.title;
    if (op.imageStyle===null) delete lesson.imageStyle;
    else if (op.imageStyle!==undefined) lesson.imageStyle=op.imageStyle;
    if (op.theme && op.theme !== lesson.theme) {
      lesson.theme = op.theme;
      delete lesson.brand;
      delete lesson.powerPointStyle;
      for (const slide of lesson.slides) {
        delete slide.powerPointLayoutId;
        if (slide.design && !slide.design.theme) {
          slide.design = { ...slide.design, theme: 'deck' };
          slide.version++;
        }
      }
    }
  } else if (op.kind === 'outline') {
    if (lesson.phase !== 'outline') throw new LessonEditError('conflict', 'The outline is already approved.');
    const existingIds = new Set(op.outline.map((item) => item.id));
    const laterItems = outlineRunActive ? lesson.outline.filter((item) => !existingIds.has(item.id)) : [];
    lesson.outline = [...op.outline, ...laterItems];
  } else {
    if (lesson.phase !== 'editing')
      throw new LessonEditError('conflict', 'Finish generation before changing slide order.');
    const previousOutline=new Map(lesson.outline.map(item=>[item.id,item]));
    if (op.kind === 'reorder') {
      if (op.slideIds.length !== lesson.slides.length || new Set(op.slideIds).size !== lesson.slides.length)
        throw new LessonEditError('invalid', 'The order must include each slide once.');
      lesson.slides = op.slideIds.map((sid) => getSlide(lesson, sid));
    } else if (op.kind==='copySlides' || op.kind==='removeSlides') {
      const source=op.kind==='copySlides' && op.sourceDeckId!==lesson.id ? copySource : lesson;
      if (!source || (op.kind==='copySlides' && (source.id!==op.sourceDeckId || source.revision!==op.sourceRevision)))
        throw new LessonEditError('conflict','The source lesson changed. Open the selection again.');
      const ids=new Set(op.slideIds);
      const selected=source.slides.filter(slide=>ids.has(slide.id));
      if (!selected.length || selected.length!==op.slideIds.length || selected.some(slide=>slide.status!=='ready'))
        throw new LessonEditError('invalid','Select each ready slide once.');
      if (op.kind==='removeSlides') {
        if (selected.length===lesson.slides.length) throw new LessonEditError('invalid','Keep at least one slide.');
        lesson.slides=lesson.slides.filter(slide=>!ids.has(slide.id));
      } else {
        if (lesson.slides.length+selected.length>maxLessonSlides)
          throw new LessonEditError('invalid',`A lesson can hold ${maxLessonSlides} slides.`);
        const after=op.afterId ? lesson.slides.indexOf(getSlide(lesson,op.afterId)) : lesson.slides.length-1;
        const copies=selected.map(slide=>{
          const copy={...structuredClone(slide),id:newId(),version:1};
          const original=source.outline.find(item=>item.id===slide.id);
          if (original) {
            const metadata={...structuredClone(original),id:copy.id};
            if (source.id!==lesson.id) delete metadata.sourceExcerptId;
            previousOutline.set(copy.id,metadata);
          }
          // Source ranges refer to the originating lesson's private document.
          if (source.id!==lesson.id) {
            delete copy.evidence;
            delete copy.powerPointLayoutId;
          }
          return copy;
        });
        lesson.slides.splice(after+1,0,...copies);
        if (source.id!==lesson.id && (source.source || source.provider==='local')) lesson.provider='local';
      }
    } else if (op.kind === 'remove') {
      getSlide(lesson, op.slideId);
      if (lesson.slides.length <= 1) throw new LessonEditError('invalid', 'Keep at least one slide.');
      lesson.slides = lesson.slides.filter((s) => s.id !== op.slideId);
    } else {
      if (lesson.slides.length >= maxLessonSlides) throw new LessonEditError('invalid', `The lesson already holds ${maxLessonSlides} slides.`);
      const source = op.kind === 'duplicate' ? getSlide(lesson, op.slideId) : undefined;
      const afterId = op.kind === 'add' ? op.afterId : op.slideId;
      const after = afterId ? lesson.slides.indexOf(getSlide(lesson, afterId)) : lesson.slides.length - 1;
      const sid = ('newSlideId' in op ? op.newSlideId : undefined) ?? newId();
      if (lesson.slides.some((slide) => slide.id === sid)) throw new LessonEditError('conflict', 'Slide id already exists.');
      const slide: Slide = source
        ? { ...structuredClone(source), id: sid, version: 1 }
        : {
            id: sid,
            status: 'ready',
            version: 1,
            title: '',
            body: '',
            notes: '',
            layout: 'body',
            lessonPart: 'lesson',
          };
      const original=source && previousOutline.get(source.id);
      if (original) previousOutline.set(sid,{...structuredClone(original),id:sid});
      if (op.kind === 'add' && 'content' in op && op.content) Object.assign(slide, op.content);
      if (op.kind==='add' && 'diagram' in op && op.diagram) {
        slide.diagram=structuredClone(op.diagram);
        slide.title=lesson.slides[after]?.title.trim() || lesson.title.trim() || diagramNames[lesson.language][op.diagram.kind];
      }
      lesson.slides.splice(after + 1, 0, slide);
    }
    lesson.outline = lesson.slides.map((s) => ({
      ...previousOutline.get(s.id),
      id: s.id,
      title: s.title,
      summary: s.body,
      layout: s.layout,
    }));
  }
}

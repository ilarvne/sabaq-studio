import { slideImages, type Deck, type Slide } from '@sabaq/lesson/types';
import type { QualityIssue, QualityReport } from '@sabaq/contracts/quality';
import { coeditLimits } from '@sabaq/lesson/coedit';
import type { MediaRoots } from '../media/powerpoint';
import { measureSlideQuality } from '../media/render-export';
import { catalogDescription } from '../media/visuals';

type Measure = typeof measureSlideQuality;
type Review = { state: 'reviewed' | 'unavailable'; slides: Slide[]; reports: Record<string, QualityReport> };

function semanticIssues(slide: Slide): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const images=slideImages(slide);
  if (!slide.title.trim()) issues.push('missing-title');
  const hasContent = slide.body.trim() || slide.answer?.trim() || slide.table?.rows.length || slide.chart?.categories.length ||
    images.length || slide.diagram?.nodes.length || slide.design?.cards?.length || slide.design?.takeaway?.trim() ||
    slide.objects?.some(object => object.kind === 'text' && object.text.trim());
  if ((!hasContent && slide.layout !== 'cover') || (slide.layout === 'native-table' && !slide.table?.rows.length) ||
      (slide.design?.cards?.some(card => !card.title.trim() || !card.text.trim())) ||
      (slide.layout === 'data-chart' && (!slide.chart?.categories.length || !slide.chart.series.length))) issues.push('empty-content');
  if (images.some(image=>!image.decorative && !image.alt.trim()) || (slide.chart && !slide.chart.alt.trim())) issues.push('missing-alt');
  return issues;
}

function repairMetadata(deck: Deck, slide: Slide) {
  if (!slide.title.trim()) {
    const title = deck.outline.find(item => item.id === slide.id)?.title?.trim();
    if (title) slide.title = title;
  }
  for (const image of slideImages(slide)) {
    if (image.decorative || image.alt.trim()) continue;
    const description = catalogDescription(image.src, deck.language);
    if (description) image.alt = description;
  }
  if (slide.chart && !slide.chart.alt.trim() && slide.chart.categories.length) {
    const { categories, series } = slide.chart;
    const numbers = new Intl.NumberFormat(deck.language, { maximumSignificantDigits: 15 });
    const label = { kk: 'Бағандық диаграмма', ru: 'Столбчатая диаграмма', en: 'Column chart' }[deck.language];
    const samples = series.slice(0, 3).map(entry => {
      const values = categories.slice(0, 5).map((category, i) => category + ' ' + numbers.format(entry.values[i]));
      return entry.name + ' — ' + values.join(', ');
    });
    slide.chart.alt = Array.from(label + '. ' + samples.join('. ')).slice(0, 900).join('');
  }
}

const canRearrange = new Set<QualityIssue>(['overflow', 'overlap', 'contrast', 'small-type']);
const needsReadableFit = (issues: QualityIssue[]) =>
  issues.some(issue => issue === 'overflow' || issue === 'overlap' || issue === 'small-type');

function compactBody(slide: Slide, segmenter: Intl.Segmenter): Slide | undefined {
  if (slide.importedPage || slide.importedArtwork || slide.freeLayout || slide.objects?.length || slide.answer ||
      slide.bodyRuns?.length || slide.richText?.body) return;
  const segments = segmenter.segment(slide.body)[Symbol.iterator]();
  const first = segments.next().value;
  const next = segments.next().value;
  if (!first || !next) return;
  const body = first.segment.trim();
  const detail = slide.body.slice(next.index).trim();
  if (!/[.!?…][»”"')\]]*$/u.test(body) || !detail) return;
  const notes = slide.notes.includes(detail) ? slide.notes : [slide.notes, detail].filter(Boolean).join('\n\n');
  if (notes.length <= coeditLimits.notes) return { ...slide, body, notes };
}

function repeatedLayoutIds(slides: Slide[]) {
  const repeated = new Set<string>();
  let previous: string | undefined;
  let count = 0;
  for (const slide of slides) {
    const layout = slide.importedPage || slide.importedArtwork || slide.freeLayout ? undefined :
      slide.layout === 'body' && slide.design?.variant ? 'story-' + slide.design.variant : slide.layout;
    count = layout && layout === previous ? count + 1 : 1;
    previous = layout;
    if (layout && count === 3) {
      repeated.add(slide.id);
      count = 0;
    }
  }
  return repeated;
}

export async function reviewSlides(deck: Deck, roots: MediaRoots, eligible: Record<string, number>, signal: AbortSignal, measure: Measure = measureSlideQuality): Promise<Review> {
  const slides = deck.slides.filter(slide => slide.status === 'ready').map(slide => structuredClone(slide));
  const reports: Review['reports'] = {};
  for (const slide of slides) {
    if (eligible[slide.id] === slide.version) repairMetadata(deck, slide);
    reports[slide.id] = { version: slide.version, issues: semanticIssues(slide) };
  }
  try {
    const geometry = await measure({ ...deck, slides }, roots, signal);
    for (const slide of slides) {
      if (!geometry[slide.id]) throw new Error('Incomplete slide measurement.');
      reports[slide.id].issues = [...new Set([...reports[slide.id].issues, ...geometry[slide.id]])];
    }
    const explicitImageLayout = deck.imageMode === 'illustrated' || deck.imageMode === 'image-led';
    const repeated = repeatedLayoutIds(slides);
    const attempts = slides.filter(slide => !slide.importedPage && !slide.importedArtwork && !slide.freeLayout && !(explicitImageLayout && slide.image) &&
      eligible[slide.id] === slide.version && (repeated.has(slide.id) ||
        reports[slide.id].issues.some(issue => canRearrange.has(issue)))).map(slide => ({
        ...slide, layout: slide.layout === 'stacked' ? 'split' as const : 'stacked' as const,
      }));
    if (attempts.length) {
      const changed = await measure({ ...deck, slides: attempts }, roots, signal);
      for (const candidate of attempts) {
        if (!changed[candidate.id]) continue;
        const before = reports[candidate.id].issues;
        const after = [...new Set([...semanticIssues(candidate), ...changed[candidate.id]])];
        if ((repeated.has(candidate.id) || before.some(issue => canRearrange.has(issue) && !after.includes(issue))) &&
            after.every(issue => before.includes(issue))) {
          slides.find(slide => slide.id === candidate.id)!.layout = candidate.layout;
          reports[candidate.id].issues = after;
        }
      }
    }
    const segmenter = new Intl.Segmenter(deck.language, { granularity: 'sentence' });
    const assessmentIds = new Set(deck.outline.filter(item => item.assessment).map(item => item.id));
    const compacted = slides.flatMap(slide => {
      if (eligible[slide.id] !== slide.version || assessmentIds.has(slide.id) || !needsReadableFit(reports[slide.id].issues)) return [];
      const candidate = compactBody(slide, segmenter);
      return candidate ? [candidate] : [];
    });
    if (compacted.length) {
      const changed = await measure({ ...deck, slides: compacted }, roots, signal).catch(error => {
        if (signal.aborted) throw error;
        return undefined;
      });
      for (const candidate of compacted) {
        const measured = changed?.[candidate.id];
        if (!measured) continue;
        const before = reports[candidate.id].issues;
        const after = [...new Set([...semanticIssues(candidate), ...measured])];
        if (needsReadableFit(after) || !after.every(issue => before.includes(issue))) continue;
        const slide = slides.find(slide => slide.id === candidate.id)!;
        slide.body = candidate.body;
        slide.notes = candidate.notes;
        reports[candidate.id].issues = after;
      }
    }
    for (const id of repeatedLayoutIds(slides)) reports[id].issues.push('repeated-layout');
    return { state: 'reviewed', slides, reports };
  } catch (error) {
    if (signal.aborted) throw error;
    return { state: 'unavailable', slides, reports };
  }
}

export class LessonQualityQueue {
  private waiting = new Set<string>();
  private controller = new AbortController();
  private worker?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private read: (id: string) => Deck, private write: (snapshot: Deck, result: Review) => void,
    private roots: MediaRoots, private measure?: Measure) {}

  enqueue(id: string) {
    if (this.controller.signal.aborted) return;
    this.waiting.add(id);
    if (this.worker || this.timer) return;
    // Coalesce generation completions and let interactive edits land before measuring their revision.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.worker = this.drain().finally(() => {
        this.worker = undefined;
        const next = this.waiting.values().next().value;
        if (next) this.enqueue(next);
      });
    }, 100);
  }

  private async drain() {
    const { signal } = this.controller;
    for (const id of this.waiting) {
      this.waiting.delete(id);
      if (signal.aborted) return;
      const snapshot = this.read(id);
      if (snapshot.qualityReview?.state !== 'pending') continue;
      const result = await reviewSlides(snapshot, this.roots, snapshot.qualityReview.repair, signal, this.measure)
        .catch(() => undefined);
      if (!signal.aborted && result) this.write(snapshot, result);
    }
  }

  async close() {
    this.controller.abort();
    clearTimeout(this.timer);
    this.waiting.clear();
    await this.worker;
  }
}

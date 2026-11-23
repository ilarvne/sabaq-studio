import {videoFrame,type VideoSettings} from '@sabaq/contracts/video';
import type {Locale,Slide} from '@sabaq/lesson/types';
import {spokenNarration} from '@sabaq/lesson/narration';
import {ApiError} from '../errors';

export function scenePlan(slide:Slide,language:Locale,settings:VideoSettings) {
  const notes=slide.notes.trim();
  const paragraphs=settings.revealParagraphs ? notes.split(/\n+/u).map(line=>line.trim()).filter(Boolean) : [notes];
  if(paragraphs.length>12) throw new ApiError(422,'Use up to 12 narration paragraphs per slide for progressive reveals.');
  if(paragraphs.length>1 && slide.importedPage)
    throw new ApiError(422,'Image-only pages have no editable elements for progressive reveals.');
  return {paragraphs:(paragraphs.length ? paragraphs:['']).map(text=>spokenNarration(text,language)),frame:videoFrame(settings)};
}

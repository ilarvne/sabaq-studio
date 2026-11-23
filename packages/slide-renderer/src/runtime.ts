import type { VideoSettings } from '@sabaq/contracts/video';
import type { Deck } from '@sabaq/lesson/types';
import type { QualityIssue } from '@sabaq/contracts/quality';

export type RenderSnapshot = Pick<Deck, 'title' | 'language' | 'theme' | 'brand' | 'powerPointStyle' | 'slides'> & { revealAnswer?: boolean; video?:Pick<VideoSettings,'aspect'|'captions'|'position'|'avatarPlacement'> };

export interface RendererManifest {
  script: string;
  stylesheet: string;
  files: string[];
}

export type ContrastProbe = {
  left: number; right: number; top: number; bottom: number;
  ink: number[]; minimum: number;
};

export type QualityInspection = {
  issues: Record<string, QualityIssue[]>;
  contrast: { index: number; id: string; probes: ContrastProbe[]; needsReview: boolean }[];
};

declare global {
  interface Window {
    renderLessonExport(snapshot: RenderSnapshot): Promise<void>;
    prepareVideoSteps():number;
    showVideoStep(visible:number):void;
    measureLessonQuality(): Record<string, QualityIssue[]>;
    inspectLessonQuality(): QualityInspection;
  }
}

import type { Deck, Slide, Theme } from '@sabaq/lesson/types';
import type { LessonCitation } from './retrieval';

export type AssistantMemoryEntry = { id: string; text: string; createdAt: string };
export type AssistantAttachment = { name: string; text: string };

export type AssistantDecision = 'apply' | 'dismiss' | 'restore';
export type AssistantTextSelection = { field:'title'|'body'; start:number; end:number; text:string };
export type AssistantProposal = {
  id: string;
  status: 'pending' | 'applied' | 'dismissed' | 'stale' | 'restored';
  appliedRevision?: number;
  baseRevision?: number;
  order?: { before: string[]; after: string[] };
  actions: { kind: string; label: string; detail?: string }[];
  changes?: { slideId: string; before?: Slide; after?: Slide }[];
  themes?: { before: Theme; after: Theme };
};

export type AssistantRead = {
  tool: 'search_lesson' | 'read_slide' | 'read_outline' | 'read_slide_data';
  count: number;
  mode?: 'hybrid' | 'lexical';
};

export type AssistantActivity = {
  id: string;
  kind: 'inspect_slide' | AssistantRead['tool'] | 'recall_preferences' | 'draft_response' | 'assess_support'
    | 'shorten_text' | 'prepare_edit' | 'validate_edit' | 'generate_illustration';
  status: 'running' | 'complete' | 'error' | 'cancelled';
  slideId?: string;
  count?: number;
  mode?: AssistantRead['mode'];
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  slideId?: string;
  fileNames?: string[];
  searchedSourceLibrary?: boolean;
  selection?: AssistantTextSelection;
  status?: 'running' | 'complete' | 'cancelled' | 'error';
  /** Cumulative, output-checked reply while the turn is running. */
  streamingText?: string;
  proposal?: AssistantProposal;
  citations?: LessonCitation[];
  reads?: AssistantRead[];
  activity?: AssistantActivity[];
};

export type AssistantSnapshot = {
  messages: AssistantMessage[];
  activeClientId?: string;
  appliedRevision?: number;
  restoredRevision?: number;
  deck?: Deck;
  memory?: AssistantMemoryEntry[];
};

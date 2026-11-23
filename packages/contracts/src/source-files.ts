export const sourceFileFormats = ['txt', 'md', 'pdf', 'docx', 'png', 'jpg', 'jpeg'] as const;

export type SourceFileFormat = typeof sourceFileFormats[number];

export type SourceFile = {
  id: string;
  name: string;
  format: SourceFileFormat;
  size: number;
  characterCount: number;
  createdAt: string;
};

export type SourceFileDetail = SourceFile & { text: string };

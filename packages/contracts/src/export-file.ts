export const exportFormats = ['pptx', 'pdf', 'png'] as const;
export type ExportFormat = (typeof exportFormats)[number];
export type ExportJob = {
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  revision: number;
  format: ExportFormat;
  slideId?: string;
};

export function exportFilename(title: string, format: ExportFormat = 'pptx') {
  const clean = title.normalize('NFC')
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return (Array.from(clean).slice(0, 90).join('').trimEnd() || 'lesson') + '.' + format;
}

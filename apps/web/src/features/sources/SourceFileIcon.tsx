import { FileDocIcon, FileJpgIcon, FileMdIcon, FilePdfIcon, FilePngIcon, FileTextIcon, FileTxtIcon } from '@phosphor-icons/react';
import type { SourceFileFormat } from '@sabaq/contracts/source-files';

const fileIcons = {
  docx: FileDocIcon,
  jpeg: FileJpgIcon,
  jpg: FileJpgIcon,
  md: FileMdIcon,
  pdf: FilePdfIcon,
  png: FilePngIcon,
  txt: FileTxtIcon,
};

export function SourceFileIcon({format, className}: {format?: SourceFileFormat; className?: string}) {
  const Icon = (format && fileIcons[format]) || FileTextIcon;
  return <Icon className={className} aria-hidden="true"/>;
}

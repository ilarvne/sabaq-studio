import { useId, useState } from 'react';
import { CaretRightIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/shadcn/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/shadcn/collapsible';
import { SidebarGroup, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/shadcn/sidebar';
import { Skeleton } from '@/components/shadcn/skeleton';
import { sourceFilePath, useSourceFiles } from './source-api';
import { sourceCopy } from './source-copy';
import { SourceFileIcon } from './SourceFileIcon';

const filesLabel = { en: 'Files', kk: 'Файлдар', ru: 'Файлы' };
const recentLimit = 4;

export function SidebarFiles({locale}: {locale: Locale}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const {files, loading, failed, refresh} = useSourceFiles(open);
  const t = sourceCopy[locale];

  return (
    <SidebarGroup className="creation-recent-nav creation-files-nav" role="navigation" aria-labelledby={headingId}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="creation-recent-heading">
          <h2 id={headingId}>
            <CollapsibleTrigger className="creation-disclosure">
              <CaretRightIcon aria-hidden="true" />
              {filesLabel[locale]}
            </CollapsibleTrigger>
          </h2>
        </div>
        <CollapsibleContent className="creation-disclosure-content">
          {loading && !files.length ? (
            <div className="creation-nav-skeleton" role="status" aria-label={t.loading}>
              <Skeleton aria-hidden="true" /><Skeleton aria-hidden="true" />
            </div>
          ) : failed ? (
            <div className="creation-files-status">
              <p role="status">{t.loadFailed}</p>
              <Button type="button" variant="ghost" size="sm" onClick={refresh}>{t.retry}</Button>
            </div>
          ) : files.length ? (
            <SidebarMenuSub>
              {files.slice(0, recentLimit).map(file => (
                <SidebarMenuSubItem key={file.id}>
                  <SidebarMenuSubButton className="creation-files-download"
                    href={'/api' + sourceFilePath(file.id) + '/download'} download={file.name}
                    aria-label={`${t.download} · ${file.name}`}>
                    <SourceFileIcon format={file.format} />
                    <span className="creation-files-name">{file.name}</span>
                    <DownloadSimpleIcon aria-hidden="true" />
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          ) : <p className="creation-files-status">{t.empty}</p>}
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

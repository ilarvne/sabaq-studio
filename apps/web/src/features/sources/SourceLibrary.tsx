import { useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, DownloadSimpleIcon, FileDocIcon, FilePdfIcon, FileTextIcon, FolderOpenIcon, ImageIcon, MagnifyingGlassIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { SourceFile } from '@sabaq/contracts/source-files';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/coss/empty';
import { Input } from '@/components/coss/input';
import { Progress } from '@/components/coss/progress';
import { Select, SelectGroup, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/coss/select';
import { Skeleton } from '@/components/coss/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/coss/table';
import { words } from '@/copy';
import { ApiError, request } from '@/lib/api';
import { formatStudioDate } from '@/lib/date';
import { useMediaCapabilities } from '@/lib/media';
import { sourceCopy } from './source-copy';
import { sourceFileAccept, sourceFilePath, uploadSourceFile, useSourceFiles } from './source-api';
import './source-library.css';

const formatIcons = {pdf:FilePdfIcon, docx:FileDocIcon, txt:FileTextIcon, md:FileTextIcon, png:ImageIcon, jpg:ImageIcon, jpeg:ImageIcon};

function formatKey(file: SourceFile) {
  return file.format === 'jpeg' ? 'jpg' : file.format;
}

function fileSize(size: number, locale: Locale) {
  const [unit, divisor] = size >= 1_000_000 ? ['megabyte', 1_000_000] as const
    : size >= 1_000 ? ['kilobyte', 1_000] as const : ['byte', 1] as const;
  return new Intl.NumberFormat(locale, {style:'unit', unit, maximumFractionDigits:1}).format(size / divisor);
}

function FileStack() {
  return <div className="source-stack" aria-hidden="true">
    <span className="source-stack-sheet source-stack-sheet--rear"><span>TXT</span></span>
    <span className="source-stack-sheet source-stack-sheet--middle"><span>DOCX</span></span>
    <span className="source-stack-sheet source-stack-sheet--front">
      <FileTextIcon weight="regular"/>
      <i/><i/><i/>
      <span>PDF</span>
    </span>
  </div>;
}

export default function SourceLibrary({locale}: {locale: Locale}) {
  const t = sourceCopy[locale];
  const {ocr} = useMediaCapabilities();
  const {files, loading, failed, refresh} = useSourceFiles();
  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusAfterDelete = useRef<'upload' | 'search' | undefined>(undefined);
  const uploader = useRef<AbortController | undefined>(undefined);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<string>('all');
  const [progress, setProgress] = useState<{done:number;total:number}>();
  const [uploadResults, setUploadResults] = useState<{saved:number;errors:{name:string;message:string}[]}>();
  const [deleting, setDeleting] = useState<SourceFile>();
  const [removing, setRemoving] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  useEffect(() => () => uploader.current?.abort(), []);

  async function upload(selected: File[]) {
    if (!selected.length || uploader.current) return;
    const controller = new AbortController();
    uploader.current = controller;
    const errors: {name:string;message:string}[] = [];
    let saved = 0;
    setUploadResults(undefined);
    setProgress({done:0,total:selected.length});
    try {
      for (const [index,file] of selected.entries()) {
        if (controller.signal.aborted) break;
        try {
          await uploadSourceFile(file, locale, ocr, controller.signal);
          saved++;
        } catch (error) {
          if (controller.signal.aborted) break;
          const message = error instanceof ApiError && [413,415].includes(error.status) ? t.unsupportedFile : t.failedFile;
          errors.push({name:file.name,message});
        }
        setProgress({done:index + 1,total:selected.length});
      }
    } finally {
      uploader.current = undefined;
      if (!controller.signal.aborted) {
        setProgress(undefined);
        setUploadResults({saved,errors});
        refresh();
      }
    }
  }

  async function remove() {
    if (!deleting || removing) return;
    setRemoving(true);
    setDeleteFailed(false);
    try {
      await request(sourceFilePath(deleting.id), {method:'DELETE'});
      focusAfterDelete.current = files.length === 1 ? 'upload' : 'search';
      setDeleting(undefined);
      refresh();
    } catch {
      setDeleteFailed(true);
    } finally {
      setRemoving(false);
    }
  }

  const formats = [...new Set(files.map(formatKey))].sort();
  const currentFormat = formats.some(key => key === format) ? format : 'all';
  const needle = query.trim().toLocaleLowerCase(locale);
  const matches = files.filter(file => (currentFormat === 'all' || formatKey(file) === currentFormat)
    && file.name.toLocaleLowerCase(locale).includes(needle));
  return <section className="source-library" aria-labelledby="source-library-title">
    <header className="source-library-header">
      <h1 id="source-library-title">{t.title}</h1>
      <p>{t.description}</p>
    </header>
    <section className="source-dropzone" data-dragging={dragging ? '' : undefined} aria-labelledby="source-dropzone-title"
      onDragEnter={event=>{
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(!uploader.current);
      }}
      onDragOver={event=>{
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = uploader.current ? 'none' : 'copy';
      }}
      onDragLeave={()=>{
        dragDepth.current=Math.max(0,dragDepth.current-1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={event=>{
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current=0;
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}>
      <div className="source-dropzone-content">
        <h2 id="source-dropzone-title">{dragging ? t.dropHere : t.uploadTitle}</h2>
        <p>{t.uploadHint}</p>
        <input hidden ref={input} type="file" accept={sourceFileAccept(ocr)} multiple onChange={event=>{
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void upload(selected);
        }}/>
        <div className="source-dropzone-actions">
          <Button ref={uploadButton} onClick={()=>input.current?.click()} disabled={Boolean(progress)} aria-describedby="source-upload-formats"><UploadSimpleIcon data-icon="inline-start" aria-hidden/>{t.upload}</Button>
          <span id="source-upload-formats">{ocr ? `${t.formats} · ${t.scans}` : t.formats}</span>
        </div>
        {progress && <div className="source-upload-progress">
          <p role="status">{t.processing(progress.done,progress.total)}</p>
          <Progress aria-label={t.upload} value={progress.done} max={progress.total}/>
        </div>}
      </div>
      <FileStack/>
    </section>

    {uploadResults && <div className="source-upload-results">
      {uploadResults.saved > 0 && <p role="status"><CheckCircleIcon aria-hidden/>{t.complete(uploadResults.saved)}</p>}
      {uploadResults.errors.length > 0 && <ul aria-live="polite">{uploadResults.errors.map(({name,message},index)=><li key={index}>
        <WarningCircleIcon aria-hidden/><span><strong>{name}</strong> · {message}</span>
      </li>)}</ul>}
    </div>}

    <section className="source-register" aria-labelledby="source-register-title" aria-busy={loading}>
      <div className="source-register-toolbar">
        <h2 id="source-register-title">{t.allFiles}{!failed && (!loading || files.length > 0) && <span>{new Intl.NumberFormat(locale).format(matches.length)}</span>}</h2>
        {files.length > 0 && <div className="source-register-filters">
          <div className="source-search"><MagnifyingGlassIcon aria-hidden/>
            <Input ref={search} type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={event=>setQuery(event.target.value)}/>
          </div>
          {formats.length > 1 && <Select value={currentFormat} onValueChange={value=>setFormat(value ?? 'all')}>
            <SelectTrigger aria-label={t.format}><SelectValue>{currentFormat === 'all' ? t.allFormats : currentFormat.toUpperCase()}</SelectValue></SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectGroup><SelectItem value="all">{t.allFormats}</SelectItem>
                {formats.map(key=><SelectItem key={key} value={key}>{key.toUpperCase()}</SelectItem>)}
              </SelectGroup>
            </SelectPopup>
          </Select>}
        </div>}
      </div>

      {loading && !files.length ? <div role="status" aria-label={t.loading} className="source-register-loading">
        <Skeleton/><Skeleton/><Skeleton/>
      </div> : failed ? <Empty className="source-register-state">
        <EmptyHeader><EmptyMedia variant="icon"><WarningCircleIcon aria-hidden/></EmptyMedia><EmptyTitle role="alert">{t.loadFailed}</EmptyTitle></EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={refresh}>{t.retry}</Button></EmptyContent>
      </Empty> : matches.length ? <div className="source-register-table"><Table aria-label={t.title}>
        <TableHeader><TableRow><TableHead scope="col">{t.file}</TableHead><TableHead scope="col" className="source-file-size">{t.size}</TableHead>
          <TableHead scope="col" className="source-file-date">{t.added}</TableHead><TableHead scope="col" className="text-end">{t.actions}</TableHead></TableRow></TableHeader>
        <TableBody>{matches.map(file=>{
          const Icon = formatIcons[file.format];
          const size = fileSize(file.size, locale);
          return <TableRow key={file.id}>
            <TableCell className="source-file-cell"><div className="source-file-identity">
              <span className="source-file-icon"><Icon aria-hidden/></span>
              <div className="source-file-text"><span className="source-file-name" title={file.name}>{file.name}</span>
                <span className="source-file-format">{formatKey(file).toUpperCase()}<span className="source-file-size-small"> · {size}</span></span>
              </div>
            </div></TableCell>
            <TableCell className="source-file-size">{size}</TableCell>
            <TableCell className="source-file-date"><time dateTime={file.createdAt}>{formatStudioDate(file.createdAt,locale)}</time></TableCell>
            <TableCell><div className="source-file-actions">
              <Button variant="ghost" size="icon" render={<a href={'/api'+sourceFilePath(file.id)+'/download'} download={file.name}/>} title={t.download} aria-label={`${t.download} · ${file.name}`}><DownloadSimpleIcon aria-hidden/></Button>
              <Button variant="ghost" size="icon" title={t.remove} aria-label={`${t.remove} · ${file.name}`} onClick={()=>{focusAfterDelete.current=undefined;setDeleting(file);setDeleteFailed(false);}}><TrashIcon aria-hidden/></Button>
            </div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table></div> : <Empty className="source-register-state" data-empty-library={!files.length ? '' : undefined}>
        <EmptyHeader><EmptyMedia variant={files.length ? 'icon' : 'default'}>{files.length ? <MagnifyingGlassIcon aria-hidden/> : <FolderOpenIcon aria-hidden/>}</EmptyMedia>
          <div className="source-register-state-copy">
            <EmptyTitle>{files.length ? t.noResults : t.empty}</EmptyTitle>
            <EmptyDescription>{files.length ? t.noResultsHint : t.emptyHint}</EmptyDescription>
          </div>
        </EmptyHeader>
        {files.length > 0 && <EmptyContent><Button variant="outline" onClick={()=>{
          setQuery('');setFormat('all');search.current?.focus();
        }}>{t.clearFilters}</Button></EmptyContent>}
      </Empty>}
    </section>
    <Dialog open={Boolean(deleting)} onOpenChange={value=>{if(!value && !removing)setDeleting(undefined);}}>
      <DialogPopup showCloseButton={false} finalFocus={()=>focusAfterDelete.current === 'upload' ? uploadButton.current : focusAfterDelete.current === 'search' ? search.current : undefined}>
        <DialogHeader><DialogTitle>{t.confirmDelete}</DialogTitle><DialogDescription>{deleting?.name} · {t.deleteHint}</DialogDescription>
          {deleteFailed && <p role="alert" className="text-sm text-destructive-foreground">{t.deleteFailed}</p>}</DialogHeader>
        <DialogFooter><DialogClose render={<Button variant="outline" disabled={removing}/>}>{words[locale].cancel}</DialogClose>
          <Button variant="destructive-outline" loading={removing} onClick={()=>void remove()}>{t.remove}</Button></DialogFooter>
      </DialogPopup>
    </Dialog>
  </section>;
}

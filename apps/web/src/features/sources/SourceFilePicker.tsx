import { useEffect, useRef, useState } from 'react';
import { FolderOpenIcon, MagnifyingGlassIcon, PaperclipIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { SourceFile } from '@sabaq/contracts/source-files';
import type { Locale } from '@sabaq/lesson/types';
import { Checkbox } from '@/components/coss/checkbox';
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';
import { Progress } from '@/components/coss/progress';
import { Button } from '@/components/shadcn/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/shadcn/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/shadcn/input-group';
import { Item, ItemContent, ItemMedia } from '@/components/shadcn/item';
import { Skeleton } from '@/components/shadcn/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs';
import { words } from '@/copy';
import { ApiError } from '@/lib/api';
import { sourceCopy } from './source-copy';
import { sourceFileAccept, uploadSourceFile, useSourceFiles } from './source-api';
import { SourceFileIcon } from './SourceFileIcon';
import './source-file-picker.css';

type Props = {
  locale: Locale;
  limit: number;
  selected?: readonly string[];
  exclude?: readonly string[];
  disabled?: boolean;
  iconOnly?: boolean;
  allowScans?: boolean;
  className?: string;
  onSelect(files: SourceFile[]): void;
  onSearchAll?: () => void;
};

const copy = {
  en: { title: 'Add files', trigger: 'Attach source material', upload: 'Upload', browse: 'Choose files',
    fromDevice: 'Upload from your device', saved: 'Uploads are saved to My files.', cancel: 'Cancel',
    full: 'Remove a selection to add more files.', unavailable: 'All your files are already attached.' },
  ru: { title: 'Добавить файлы', trigger: 'Прикрепить материалы', upload: 'Загрузка', browse: 'Выбрать файлы',
    fromDevice: 'Загрузить с устройства', saved: 'Загруженные документы сохраняются в «Моих файлах».', cancel: 'Отмена',
    full: 'Снимите отметку с файла, чтобы добавить другие.', unavailable: 'Все ваши файлы уже прикреплены.' },
  kk: { title: 'Файлдарды қосу', trigger: 'Материал тіркеу', upload: 'Жүктеу', browse: 'Файлдарды таңдау',
    fromDevice: 'Құрылғыдан жүктеу', saved: 'Жүктелген құжаттар «Менің файлдарым» бөлімінде сақталады.', cancel: 'Бас тарту',
    full: 'Басқа файл қосу үшін таңдалған файлдың белгісін алып тастаңыз.', unavailable: 'Барлық файлдарыңыз тіркелген.' },
};

type PickerTab = 'library' | 'upload';
type UploadError = { name: string; message: string };

function FileRows({files, chosen, full, onToggle}: {
  files: SourceFile[]; chosen: string[]; full: boolean; onToggle(id: string, checked: boolean): void;
}) {
  return <ul className="source-picker-rows">
    {files.map(file => {
      const checked = chosen.includes(file.id);
      return <li key={file.id}>
        <Item render={<label/>} size="sm" data-selected={checked} className="source-picker-file">
          <ItemMedia variant="icon" className="source-picker-file-icon"><SourceFileIcon format={file.format}/></ItemMedia>
          <ItemContent>
            <span className="truncate font-medium" title={file.name}>{file.name}</span>
            <span className="text-xs text-muted-foreground">{file.format.toUpperCase()}</span>
          </ItemContent>
          <Checkbox aria-label={file.name} checked={checked} disabled={full && !checked}
            onCheckedChange={value=>onToggle(file.id,value)}/>
        </Item>
      </li>;
    })}
  </ul>;
}

export function SourceFilePicker({locale, limit, selected = [], exclude = [], disabled, iconOnly, allowScans = false, className, onSelect, onSearchAll}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>('library');
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [uploaded, setUploaded] = useState<SourceFile[]>([]);
  const [progress, setProgress] = useState<{done: number; total: number}>();
  const [errors, setErrors] = useState<UploadError[]>([]);
  const [limitError, setLimitError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  const {files, loading, failed, refresh} = useSourceFiles(open);
  const t = sourceCopy[locale];
  const labels = copy[locale];

  useEffect(()=>()=>upload.current?.abort(),[]);
  const eligible = [...new Map([...uploaded, ...files].map(file=>[file.id,file])).values()]
    .filter(file=>!exclude.includes(file.id));
  const matches = eligible.filter(file=>file.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));
  const picked = chosen.flatMap(id=>{
    const file = eligible.find(item=>item.id===id);
    return file ? [file] : [];
  });
  const remaining = limit - chosen.length;

  function changeOpen(next: boolean) {
    if (next) {
      setTab('library');
      setQuery('');
      setChosen([...selected].slice(0,limit));
      setUploaded([]);
      setErrors([]);
      setLimitError(false);
    } else {
      upload.current?.abort();
      upload.current = null;
      setProgress(undefined);
      dragDepth.current = 0;
      setDragging(false);
    }
    setOpen(next);
  }

  function changeTab(value: PickerTab) {
    dragDepth.current = 0;
    setDragging(false);
    setTab(value);
  }

  function toggle(id: string, checked: boolean) {
    setLimitError(false);
    setChosen(previous=>checked
      ? previous.length < limit && !previous.includes(id) ? [...previous,id] : previous
      : previous.filter(item=>item!==id));
  }

  async function addUploads(filesToSave: File[]) {
    if (upload.current || !filesToSave.length) return;
    if (filesToSave.length > remaining) {
      setLimitError(true);
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setErrors([]);
    setLimitError(false);
    setProgress({done:0,total:filesToSave.length});
    try {
      for (const [index,file] of filesToSave.entries()) {
        try {
          const saved = await uploadSourceFile(file,locale,allowScans,controller.signal);
          if (controller.signal.aborted) return;
          setUploaded(previous=>previous.some(item=>item.id===saved.id) ? previous : [...previous,saved]);
          toggle(saved.id,true);
        } catch (error) {
          if (controller.signal.aborted) return;
          if (!(error instanceof DOMException && error.name==='AbortError')) {
            const message = error instanceof ApiError && [413,415].includes(error.status) ? t.unsupportedFile : t.failedFile;
            setErrors(previous=>[...previous,{name:file.name,message}]);
          }
        }
        setProgress({done:index+1,total:filesToSave.length});
      }
    } finally {
      if (upload.current===controller) {
        upload.current = null;
        setProgress(undefined);
      }
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button type="button" variant={iconOnly ? 'ghost' : 'outline'} size={iconOnly ? 'icon-sm' : 'sm'}/>}
      disabled={disabled} aria-label={iconOnly ? labels.trigger : undefined} title={iconOnly ? labels.trigger : undefined} className={className}>
      <PaperclipIcon aria-hidden data-icon={iconOnly ? undefined : 'inline-start'}/>{!iconOnly && labels.title}
    </DialogTrigger>
    <DialogPopup className="source-picker" backdropClassName="bg-black/45 backdrop-blur-none"
      viewportClassName="grid-rows-[1fr_auto_1fr]" bottomStickOnMobile={false}
      closeProps={{'aria-label':words[locale].close}}>
      <DialogHeader><DialogTitle>{labels.title}</DialogTitle><DialogDescription>{t.chooseUpTo(limit)}</DialogDescription></DialogHeader>
      <Tabs value={tab} onValueChange={changeTab} className="source-picker-tabs">
        <TabsList className="source-picker-tablist" aria-label={labels.title}>
          <TabsTrigger value="library" disabled={Boolean(progress)}><FolderOpenIcon aria-hidden data-icon="inline-start"/>{t.title}</TabsTrigger>
          <TabsTrigger value="upload"><UploadSimpleIcon aria-hidden data-icon="inline-start"/>{labels.upload}</TabsTrigger>
        </TabsList>
        <DialogPanel className="source-picker-content" scrollFade={false}>
          <TabsContent value="library" className="source-picker-tab">
            <InputGroup className="min-h-9">
              <InputGroupAddon><MagnifyingGlassIcon aria-hidden/></InputGroupAddon>
              <InputGroupInput type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={event=>setQuery(event.target.value)}/>
            </InputGroup>
            {loading && !eligible.length ? <div role="status" className="source-picker-state">
              <span className="sr-only">{t.loading}</span>
              <Skeleton className="h-12"/><Skeleton className="h-12"/>
            </div> : failed && !eligible.length ? <Empty className="source-picker-empty">
              <EmptyHeader><EmptyMedia variant="icon"><WarningCircleIcon aria-hidden/></EmptyMedia><EmptyTitle role="alert">{t.loadFailed}</EmptyTitle></EmptyHeader>
              <EmptyContent><Button type="button" variant="outline" size="sm" onClick={refresh}>{t.retry}</Button></EmptyContent>
            </Empty> : matches.length ? <FileRows files={matches} chosen={chosen} full={remaining<=0} onToggle={toggle}/>
              : <Empty className="source-picker-empty">
                <EmptyHeader>
                  <EmptyMedia variant="icon">{query ? <MagnifyingGlassIcon aria-hidden/> : <FolderOpenIcon aria-hidden/>}</EmptyMedia>
                  <EmptyTitle>{query ? t.noResults : files.length ? labels.unavailable : t.empty}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>{query ? <Button type="button" variant="outline" size="sm" onClick={()=>setQuery('')}>{t.clearFilters}</Button>
                  : <Button type="button" variant="outline" size="sm" onClick={()=>changeTab('upload')}>
                    <UploadSimpleIcon aria-hidden data-icon="inline-start"/>{t.upload}
                  </Button>}</EmptyContent>
              </Empty>}
            {onSearchAll && files.length>0 && <Button type="button" variant="ghost" size="sm" className="self-start"
              disabled={Boolean(progress)} onClick={()=>{changeOpen(false);onSearchAll();}} title={t.searchAllHint}>
              <MagnifyingGlassIcon aria-hidden data-icon="inline-start"/>{t.searchAll}
            </Button>}
          </TabsContent>
          <TabsContent value="upload" className="source-picker-tab">
            <input ref={input} type="file" accept={sourceFileAccept(allowScans)} multiple={remaining>1} hidden
              onChange={event=>{
                void addUploads(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = '';
              }}/>
            <Empty className="source-picker-dropzone" role="region" aria-label={labels.fromDevice} data-dragging={dragging || undefined}
              onDragEnter={event=>{
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                dragDepth.current++;
                setDragging(true);
              }}
              onDragOver={event=>{
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = remaining>0 && !progress ? 'copy' : 'none';
              }}
              onDragLeave={()=>{
                dragDepth.current = Math.max(0,dragDepth.current-1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDrop={event=>{
                event.preventDefault();
                event.stopPropagation();
                dragDepth.current = 0;
                setDragging(false);
                void addUploads(Array.from(event.dataTransfer.files));
              }}>
              <EmptyHeader><EmptyMedia variant="icon"><UploadSimpleIcon aria-hidden/></EmptyMedia>
                <EmptyTitle>{dragging ? t.dropHere : labels.fromDevice}</EmptyTitle>
                <EmptyDescription>{remaining<=0 ? labels.full : `${t.formats}${allowScans ? `, ${t.scans}` : ''}`}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" size="sm" disabled={remaining<=0 || Boolean(progress)} onClick={()=>input.current?.click()}>
                  {labels.browse}
                </Button>
              </EmptyContent>
            </Empty>
            {progress && <div className="source-picker-state" role="status">
              <span className="text-sm text-muted-foreground">{t.processing(progress.done,progress.total)}</span>
              <Progress value={progress.total===1 ? null : 100 * progress.done / progress.total} aria-label={t.processing(progress.done,progress.total)}/>
            </div>}
            {limitError && <p role="alert" className="source-picker-error">{t.chooseUpTo(limit)}</p>}
            {!!errors.length && <ul role="alert" className="source-picker-error">
              {errors.map(({name,message},index)=><li key={index}><strong>{name}</strong> · {message}</li>)}
            </ul>}
            {uploaded.length>0 && <FileRows files={uploaded} chosen={chosen} full={remaining<=0} onToggle={toggle}/>}
            <p className="text-xs text-muted-foreground">{labels.saved}</p>
          </TabsContent>
        </DialogPanel>
      </Tabs>
      <DialogFooter className="source-picker-footer">
        <p aria-live="polite" className="source-picker-count text-sm text-muted-foreground">{t.selected(chosen.length)} / {limit}</p>
        <DialogClose render={<Button type="button" variant="ghost" size="sm"/>}>{labels.cancel}</DialogClose>
        <Button type="button" size="sm" disabled={Boolean(progress) || !picked.length} onClick={()=>{
          onSelect(picked);
          changeOpen(false);
        }}>{t.useSelected}</Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}

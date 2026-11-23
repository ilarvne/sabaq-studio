import { useState } from 'react';
import { FileTextIcon, FolderOpenIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import type { SourceFile } from '@sabaq/contracts/source-files';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { Checkbox } from '@/components/coss/checkbox';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from '@/components/coss/dialog';
import { Input } from '@/components/coss/input';
import { Label } from '@/components/coss/label';
import { words } from '@/copy';
import { sourceCopy } from './source-copy';
import { useSourceFiles } from './source-api';

type Props = {
  locale: Locale;
  limit: number;
  selected?: readonly string[];
  exclude?: readonly string[];
  disabled?: boolean;
  iconOnly?: boolean;
  onSelect(files: SourceFile[]): void;
  onSearchAll?: () => void;
};

export function SourceFilePicker({locale, limit, selected = [], exclude = [], disabled, iconOnly, onSelect, onSearchAll}: Props) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const {files, loading, failed, refresh} = useSourceFiles(open);
  const t = sourceCopy[locale];
  const eligible = files.filter(file => !exclude.includes(file.id));
  const matches = eligible.filter(file => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const changeOpen = (next: boolean) => {
    if (next) {
      setQuery('');
      setChosen([...selected]);
    }
    setOpen(next);
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button variant={iconOnly ? 'ghost' : 'outline'} size={iconOnly ? 'icon-sm' : 'sm'}/>}
      disabled={disabled} aria-label={t.pick} title={iconOnly ? t.pick : undefined}><FolderOpenIcon aria-hidden/>{!iconOnly && t.pick}</DialogTrigger>
    <DialogPopup closeProps={{'aria-label': words[locale].close}}>
      <DialogHeader><DialogTitle>{t.pick}</DialogTitle><DialogDescription>{t.pickHint} {t.chooseUpTo(limit)}</DialogDescription></DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        <Input type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={event=>setQuery(event.target.value)}/>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t.loading}</p> : failed ?
          <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm">{t.loadFailed}</p><Button variant="outline" size="sm" onClick={refresh}>{t.retry}</Button></div> :
          matches.length ? <ul className="max-h-64 overflow-y-auto rounded-lg border divide-y divide-border">
            {matches.map(file => <li key={file.id}>
              <Label className="flex min-h-10 items-center gap-2 px-3 py-2 text-sm">
                <Checkbox checked={chosen.includes(file.id)} disabled={limit <= chosen.length && !chosen.includes(file.id)}
                  onCheckedChange={value=>setChosen(previous=>value ? [...previous,file.id] : previous.filter(id=>id!==file.id))}/>
                <FileTextIcon className="shrink-0 text-muted-foreground" aria-hidden/>
                <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><span className="text-xs text-muted-foreground">{file.format.toUpperCase()}</span>
              </Label>
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">{query ? t.noResults : t.empty} {!query && !files.length && <a className="underline underline-offset-4" href="#/files" onClick={()=>setOpen(false)}>{t.title}</a>}</p>}
        {onSearchAll && <Button variant="outline" size="sm" className="self-start" disabled={loading || failed || !files.length}
          onClick={()=>{setOpen(false);onSearchAll();}} title={t.searchAllHint}><MagnifyingGlassIcon aria-hidden/>{t.searchAll}</Button>}
      </DialogPanel>
      <DialogFooter>
        <p aria-live="polite" className="self-center text-sm text-muted-foreground sm:me-auto">{t.selected(chosen.length)}</p>
        <Button disabled={loading || failed || !eligible.some(file=>chosen.includes(file.id))} onClick={()=>{
          onSelect(chosen.flatMap(id=>{const file=eligible.find(item=>item.id===id);return file ? [file] : [];}));
          setOpen(false);
        }}>{t.useSelected}</Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}

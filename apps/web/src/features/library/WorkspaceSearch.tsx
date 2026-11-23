import { HouseIcon, ArrowRightIcon, BooksIcon, FileTextIcon, FolderOpenIcon, PlusIcon, SquaresFourIcon } from '@phosphor-icons/react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { Command, CommandDialog, CommandDialogPopup, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/coss/command';
import { DialogDescription, DialogTitle } from '@/components/coss/dialog';
import { homeCopy } from '@/features/home/home-copy';
import { sourceCopy } from '@/features/sources/source-copy';
import { searchCopy, words } from '@/copy';

export function WorkspaceSearch({ locale, decks, open, onOpenChange, onNavigate, onNew }: {
  locale:Locale; decks:Deck[]; open:boolean; onOpenChange:(open:boolean)=>void;
  onNavigate:(path:string)=>void; onNew:()=>void;
}) {
  const c = searchCopy[locale];
  const t = words[locale];
  const choose = (action:()=>void) => {
    onOpenChange(false);
    action();
  };
  const entries = [
    { value:'new', label:t.newLesson, Icon:PlusIcon, onSelect:onNew },
    { value:'home', label:homeCopy[locale].home, Icon:HouseIcon, onSelect:()=>onNavigate('home') },
    { value:'library', label:t.library, Icon:BooksIcon, onSelect:()=>onNavigate('library') },
    { value:'files', label:sourceCopy[locale].title, Icon:FolderOpenIcon, onSelect:()=>onNavigate('files') },
    { value:'templates', label:t.templates, Icon:SquaresFourIcon, onSelect:()=>onNavigate('templates') },
    ...decks.map(deck=>({value:'deck-'+deck.id,label:deck.title,Icon:FileTextIcon,onSelect:()=>onNavigate('deck/'+deck.id)})),
  ];
  return <CommandDialog open={open} onOpenChange={onOpenChange}>
    <CommandDialogPopup className="workspace-search">
      <DialogTitle className="sr-only">{c.title}</DialogTitle>
      <DialogDescription className="sr-only">{c.description}</DialogDescription>
      <Command items={entries} itemToStringValue={entry=>(entry as (typeof entries)[number]).label}>
        <CommandInput placeholder={c.input} aria-label={c.input} autoFocus />
        <CommandEmpty>{c.empty}</CommandEmpty>
        <CommandList>
          {(entry:(typeof entries)[number])=><CommandItem key={entry.value} value={entry} onClick={()=>choose(entry.onSelect)}>
            <entry.Icon/><span>{entry.label}</span><ArrowRightIcon className="workspace-search-arrow" aria-hidden/>
          </CommandItem>}
        </CommandList>
      </Command>
    </CommandDialogPopup>
  </CommandDialog>;
}

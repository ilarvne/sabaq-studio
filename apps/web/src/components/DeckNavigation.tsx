import { useEffect, useRef, useState } from 'react';
import { CaretDownIcon, FolderOpenIcon, HouseIcon, ListIcon, PlusIcon, SquaresFourIcon, StackIcon, XIcon } from '@phosphor-icons/react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { homeCopy } from '@/features/home/home-copy';
import { sourceCopy } from '@/features/sources/source-copy';
import { words } from '@/copy';
import { Button } from './shadcn/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from './shadcn/sheet';
import './deck-navigation.css';

export function workspaceDestinations(locale:Locale) {
  const c = homeCopy[locale];
  return [
    {page:'home', title:c.home, icon:HouseIcon},
    {page:'library', title:c.lessons, icon:StackIcon},
    {page:'files', title:sourceCopy[locale].title, icon:FolderOpenIcon},
    {page:'templates', title:c.templates, icon:SquaresFourIcon},
  ] as const;
}

function Destinations({locale, onNavigate}:{locale:Locale; onNavigate?:()=>void}) {
  return <nav className="decknav-links" aria-label={homeCopy[locale].workspace}>
    <a href="#/start" className="decknav-create" onClick={onNavigate}><PlusIcon weight="bold"/>{words[locale].newLesson}</a>
    {workspaceDestinations(locale).map(({page,title,icon:Icon})=><a key={page} href={'#/'+page} onClick={onNavigate}>
      <Icon aria-hidden="true"/>{title}
    </a>)}
  </nav>;
}

function SlideIndex({locale, deck, onJump}:{locale:Locale; deck:Deck; onJump?:(target:HTMLElement)=>void}) {
  const [current,setCurrent] = useState('');
  const items = deck.phase === 'outline' ? deck.outline : deck.slides;
  const signature = items.map(item=>item.id).join(',');
  // A ready slide can move from the generation queue into the preview grid.
  const readyCount = deck.slides.filter(item=>item.status==='ready').length;
  useEffect(()=>{
    if(!signature) return;
    const nodes = signature.split(',').map(id=>document.getElementById('workbench-slide-'+id));
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries=>{
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      const first = [...visible].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0];
      setCurrent(first?.id || '');
    },{rootMargin:'-65px 0px -45% 0px'});
    for (const node of nodes) if(node) observer.observe(node);
    return ()=>observer.disconnect();
  },[signature,readyCount]);

  if(!items.length) return null;
  return <nav className="decknav-index" aria-label={words[locale].slideSequence}>
    <h2>{words[locale].slideSequence}</h2>
    <ol>{items.map((item,index)=>{
      const id = 'workbench-slide-'+item.id;
      const title = item.title || deck.outline.find(part=>part.id===item.id)?.title || words[locale].slides;
      return <li key={item.id}><button type="button" aria-current={current===id?'location':undefined}
        onClick={()=>{
          const target = document.getElementById(id);
          if (!target) return;
          if(onJump) onJump(target);
          else {target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
        }}>
        <span className="decknav-number">{index+1}</span><span lang={deck.language}>{title}</span>
      </button></li>;
    })}</ol>
  </nav>;
}

export function DeckSidebar({locale,deck}:{locale:Locale;deck:Deck}) {
  return <aside className="decknav-side">
    <a href="#/home" className="decknav-wordmark" aria-label={`Sabaq Studio · ${homeCopy[locale].home}`}>
      <img src="/sabaq-mark.svg" width="32" height="32" alt=""/><span>Sabaq <b>Studio</b></span>
    </a>
    <Destinations locale={locale}/>
    <SlideIndex locale={locale} deck={deck}/>
  </aside>;
}

export function DeckNavigation({locale,deck}:{locale:Locale;deck?:Deck}) {
  const [open,setOpen] = useState(false);
  const jumpTarget = useRef<HTMLElement|null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const c = homeCopy[locale];
  return <div className="decknav-compact">
    <a className="decknav-mark" href="#/home" aria-label={`Sabaq Studio · ${c.home}`} title={c.home}>
      <img width="30" height="30" src="/sabaq-mark.svg" alt=""/>
    </a>
    <Sheet open={open} onOpenChange={next=>{if(next)jumpTarget.current=null;setOpen(next);}}
      onOpenChangeComplete={next=>{
        const target=jumpTarget.current;
        if(!next && target?.isConnected) {
          requestAnimationFrame(()=>{
            target.focus({preventScroll:true});
            target.scrollIntoView({block:'start'});
          });
        }
      }}>
      <SheetTrigger render={<Button ref={trigger} type="button" variant="ghost" className="decknav-trigger"/>} aria-label={`${c.workspace} · ${c.menu}`} title={c.menu}>
        <ListIcon aria-hidden="true"/><span>{c.workspace}</span><CaretDownIcon aria-hidden="true"/>
      </SheetTrigger>
      <SheetContent side="left" className="decknav-sheet" showCloseButton={false} finalFocus={()=>jumpTarget.current ? false : trigger.current}>
        <div className="decknav-sheet-heading">
          <SheetTitle>{c.workspace}</SheetTitle>
          <SheetClose render={<Button size="icon" variant="ghost" aria-label={words[locale].close}/>}><XIcon/></SheetClose>
        </div>
        <Destinations locale={locale} onNavigate={()=>setOpen(false)}/>
        {deck && <SlideIndex locale={locale} deck={deck} onJump={target=>{jumpTarget.current=target;setOpen(false);}}/>}
      </SheetContent>
    </Sheet>
  </div>;
}

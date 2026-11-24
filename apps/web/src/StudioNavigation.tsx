import { useId, useRef, type ReactNode, useState } from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  PresentationIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { Deck, Locale } from '@sabaq/lesson/types';
import { languages, words } from './copy';
import { Button } from './components/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './components/shadcn/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './components/shadcn/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/shadcn/collapsible';
import { Kbd } from './components/shadcn/kbd';
import { SlideIndex, workspaceDestinations } from './components/DeckNavigation';
import { LanguageFlag } from './components/LanguageFlag';
import { Skeleton } from './components/shadcn/skeleton';
import { homeCopy } from './features/home/home-copy';
import { SidebarFiles } from './features/sources/SidebarFiles';
import './studio-navigation.css';

type StudioPage = 'home' | 'library' | 'files' | 'templates' | 'start' | 'deck';
export interface StudioNavigationState {
  locale: Locale;
  dark: boolean;
  recent: Deck[];
  loading: boolean;
  search: ReactNode;
  statusPanel?: ReactNode;
  sidebarOpen: boolean;
  onSidebarOpen: (open: boolean) => void;
  onLocale: (value: Locale) => void;
  onAppearance: (dark: boolean) => void;
  onNew: () => void;
  onSearch: () => void;
}
interface NavigationProps extends StudioNavigationState {
  page: StudioPage;
  children: ReactNode;
  document?: { title: ReactNode; actions?: ReactNode; deck?: Deck };
}

const recentPageSize = 6;

const navigationLabels = {
  en: { search: 'Search', library: 'Lessons', files: 'Files', add: 'New' },
  kk: { search: 'Іздеу', library: 'Сабақтар', files: 'Файлдар', add: 'Жаңа' },
  ru: { search: 'Поиск', library: 'Уроки', files: 'Файлы', add: 'Новый' },
};

export function StudioLanguagePicker({locale, onLocale}: Pick<NavigationProps, 'locale' | 'onLocale'>) {
  const t = words[locale];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="creation-preferences"
            variant="ghost"
            aria-label={`${locale.toUpperCase()} · ${t.language} · ${languages[locale]}`}
            title={t.language}
          />
        }
      >
        <LanguageFlag locale={locale} />
        <span>{locale.toUpperCase()}</span>
        <CaretDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="creation-preferences-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t.language}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={locale} onValueChange={(value) => onLocale(value as Locale)}>
            {Object.entries(languages).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} lang={value} closeOnClick>
                <LanguageFlag locale={value as Locale} />{label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RecentLessons({locale, recent, loading, onNavigate}: {
  locale: Locale;
  recent: Deck[];
  loading: boolean;
  onNavigate: () => void;
}) {
  const c = homeCopy[locale];
  const [showMore, setShowMore] = useState(false);
  const headingId = useId();
  const listId = useId();
  return (
    <SidebarGroup className="creation-recent-nav" role="navigation" aria-labelledby={headingId}>
      <Collapsible defaultOpen>
        <div className="creation-recent-heading">
          <h2 id={headingId}>
            <CollapsibleTrigger className="creation-disclosure">
              <CaretRightIcon aria-hidden="true" />
              {c.recent}
            </CollapsibleTrigger>
          </h2>
        </div>
        <CollapsibleContent className="creation-disclosure-content">
          {loading ? (
            <div className="creation-nav-skeleton" aria-hidden="true"><Skeleton /><Skeleton /><Skeleton /></div>
          ) : (
            <>
              <SidebarMenuSub id={listId}>
                {recent.slice(0, showMore ? recentPageSize * 2 : recentPageSize).map((deck) => (
                  <SidebarMenuSubItem key={deck.id}>
                    <SidebarMenuSubButton render={<a href={`#/deck/${encodeURIComponent(deck.id)}`} onClick={onNavigate} />}>
                      <PresentationIcon aria-hidden="true" />
                      <span lang={deck.language}>{deck.title}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
              {recent.length > recentPageSize && (
                <button type="button" className="creation-recent-expand"
                  aria-expanded={showMore} aria-controls={listId}
                  aria-label={showMore ? c.fewerRecent : c.moreRecent}
                  onClick={() => setShowMore(expanded => !expanded)}>
                  <CaretDownIcon aria-hidden="true" />
                  {showMore ? c.fewer : c.more}
                </button>
              )}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

function NavigationContent({
  page,
  locale,
  dark,
  recent,
  loading,
  search,
  statusPanel,
  children,
  document: deckPage,
  onLocale,
  onAppearance,
  onNew,
  onSearch,
}: NavigationProps) {
  const c = homeCopy[locale];
  const t = words[locale];
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();
  const labels = navigationLabels[locale];
  const afterDrawerClose = useRef<(() => void) | null>(null);
  const topbar = useRef<HTMLElement>(null);
  const panelId = useId();
  const closeNav = () => setOpenMobile(false);
  const focusToggle = () => topbar.current?.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')?.focus();
  const runFromNav = (action: () => void) => {
    if (isMobile) {
      afterDrawerClose.current = action;
      closeNav();
    } else {
      action();
    }
  };
  const nav = workspaceDestinations(locale);
  const current = nav.find((item) => item.page === page)?.title ?? t.newLesson;
  const showPanel = isMobile || open;
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  return (
    <>
      <Sidebar className="creation-sidebar" collapsible="icon" mobileTitle={c.workspace}
        mobileFinalFocus={() => !afterDrawerClose.current}
        onMobileClose={() => {
          const action = afterDrawerClose.current;
          afterDrawerClose.current = null;
          if (action) requestAnimationFrame(action);
        }}>
        <div className="creation-nav-layout">
          <div className="creation-nav-rail">
            <a href="#/home" className="creation-brand" onClick={closeNav} aria-label={`Sabaq Studio · ${c.home}`}>
              <img src="/sabaq-mark.svg" width="34" height="34" alt="" />
            </a>
            <nav className="creation-rail-links" aria-label={c.workspace}>
              <SidebarMenu>
                {nav.map((item) => (
                  <SidebarMenuItem key={item.page}>
                    <a href={`#/${item.page}`} className="creation-rail-button" data-destination={item.page}
                      aria-label={locale === 'kk' ? undefined : item.title}
                      aria-current={page === item.page ? 'page' : undefined} onClick={closeNav}>
                      <span className="creation-rail-icon"><item.icon aria-hidden="true" weight={page === item.page ? 'fill' : 'duotone'} /></span>
                      <span className="creation-rail-label">{item.page === 'library' || item.page === 'files' ? labels[item.page] : item.title}</span>
                    </a>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
            {!showPanel && page !== 'library' && <Button variant="ghost" className="creation-rail-button creation-rail-new"
              aria-label={t.newLesson} onClick={onNew}>
              <span className="creation-rail-icon"><PlusIcon aria-hidden="true" /></span>
              <span className="creation-rail-label">{labels.add}</span>
            </Button>}
          </div>
          <div className="creation-nav-panel" id={panelId} inert={!showPanel} data-panel-open={showPanel}
            onKeyDown={event => {
              if (!isMobile && (event.metaKey || event.ctrlKey) && event.key === 'b') focusToggle();
            }}>
            <SidebarHeader className="creation-sidebar-head">
              <div className="creation-panel-primary">
                <Button className="creation-new" onClick={() => { closeNav(); onNew(); }}>
                  <PlusIcon data-icon="inline-start" weight="bold" aria-hidden="true" />{t.newLesson}
                </Button>
                {isMobile && <Button variant="ghost" size="icon" className="creation-panel-close"
                  aria-label={t.close} onClick={closeNav}><XIcon aria-hidden="true" /></Button>}
              </div>
              <Button variant="ghost" className="creation-panel-search" onClick={() => runFromNav(onSearch)}
                aria-keyshortcuts="Meta+K Control+K">
                <MagnifyingGlassIcon data-icon="inline-start" aria-hidden="true" />
                <span>{labels.search}</span>{!isMobile && <Kbd aria-hidden="true">{shortcut}</Kbd>}
              </Button>
            </SidebarHeader>
            <SidebarContent className="creation-side-scroll">
              <SidebarFiles locale={locale} />
              {deckPage?.deck && <SlideIndex collapsible locale={locale} deck={deckPage.deck} onJump={target => runFromNav(() => {
                if (!target.isConnected) return;
                target.focus({preventScroll:true});
                target.scrollIntoView({block:'start'});
              })} />}
              {!deckPage && (loading || recent.length > 0) && <RecentLessons locale={locale} recent={recent} loading={loading} onNavigate={closeNav} />}
            </SidebarContent>
          </div>
        </div>
      </Sidebar>
      <div className="creation-column">
        <header className="creation-topbar" data-document={Boolean(deckPage)} ref={topbar}>
          <SidebarTrigger aria-label={c.menu} title={c.menu} aria-expanded={isMobile ? openMobile : open}
            aria-controls={!isMobile || openMobile ? panelId : undefined} aria-keyshortcuts="Meta+B Control+B" />
          <span className="creation-top-rule" aria-hidden="true" />
          {deckPage ? deckPage.title : <div className="creation-breadcrumb">
            <span>{c.workspace}</span>
            <CaretRightIcon aria-hidden />
            <strong>{current}</strong>
          </div>}
          <div className="creation-top-actions">
            {(isMobile || !open) && search}
            <Button
              variant="ghost"
              size="icon"
              className="creation-appearance"
              aria-label={dark ? t.light : t.dark}
              title={dark ? t.light : t.dark}
              onClick={() => onAppearance(!dark)}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
            <StudioLanguagePicker locale={locale} onLocale={onLocale} />
          </div>
          {deckPage?.actions}
        </header>
        {statusPanel}
        {deckPage ? <div className="creation-content">{children}</div> : <main className="creation-content">{children}</main>}
      </div>
    </>
  );
}

export function StudioNavigation(props: NavigationProps) {
  return (
    <SidebarProvider className="studio-shell creation-shell" open={props.sidebarOpen} onOpenChange={props.onSidebarOpen}>
      <NavigationContent {...props} />
    </SidebarProvider>
  );
}

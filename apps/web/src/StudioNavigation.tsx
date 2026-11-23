import { useId, useState, type ReactNode } from 'react';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  ClockCounterClockwiseIcon,
  MoonIcon,
  PlusIcon,
  PresentationIcon,
  SunIcon,
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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './components/shadcn/sidebar';
import { workspaceDestinations } from './components/DeckNavigation';
import { LanguageFlag } from './components/LanguageFlag';
import { Skeleton } from './components/shadcn/skeleton';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from './components/coss/dialog';
import { homeCopy } from './features/home/home-copy';
import './studio-navigation.css';

type StudioPage = 'home' | 'library' | 'files' | 'templates' | 'start';
interface NavigationProps {
  page: StudioPage;
  locale: Locale;
  dark: boolean;
  recent: Deck[];
  loading: boolean;
  search: ReactNode;
  children: ReactNode;
  onLocale: (value: Locale) => void;
  onAppearance: (dark: boolean) => void;
  onNew: () => void;
}

const recentPageSize = 6;

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

function NavigationContent({
  page,
  locale,
  dark,
  recent,
  loading,
  search,
  children,
  onLocale,
  onAppearance,
  onNew,
}: NavigationProps) {
  const c = homeCopy[locale];
  const t = words[locale];
  const { setOpenMobile } = useSidebar();
  const [guideOpen, setGuideOpen] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const recentHeadingId = useId();
  const recentListId = useId();
  const closeNav = () => setOpenMobile(false);
  const nav = workspaceDestinations(locale);
  const current = nav.find((item) => item.page === page)?.title ?? t.newLesson;
  return (
    <>
      <Sidebar className="creation-sidebar" mobileTitle={c.workspace}>
        <SidebarHeader className="creation-sidebar-head">
          <a
            href="#/home"
            className="creation-brand"
            onClick={closeNav}
            aria-label={`Sabaq Studio · ${c.home}`}
          >
            <img src="/sabaq-mark.svg" width="34" height="34" alt="" />
            <span>
              Sabaq <b>Studio</b>
            </span>
          </a>
          <Button
            className="creation-new"
            onClick={() => {
              closeNav();
              onNew();
            }}
          >
            <PlusIcon weight="bold" />
            {t.newLesson}
          </Button>
        </SidebarHeader>
        <SidebarContent className="creation-side-scroll">
          <SidebarGroup className="creation-nav-group">
            <SidebarGroupLabel>{c.workspace}</SidebarGroupLabel>
            <nav aria-label={c.workspace}>
              <SidebarMenu>
                {nav.map((item) => (
                  <SidebarMenuItem key={item.page}>
                    <SidebarMenuButton
                      isActive={page === item.page}
                      render={
                        <a
                          href={`#/${item.page}`}
                          aria-current={page === item.page ? 'page' : undefined}
                          onClick={closeNav}
                        />
                      }
                    >
                      <item.icon weight={page === item.page ? 'fill' : 'regular'} />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroup>
          {(loading || recent.length > 0) && (
            <SidebarGroup className="creation-nav-group creation-recent-nav" role="navigation" aria-labelledby={recentHeadingId}>
              <div className="creation-recent-heading">
                <SidebarGroupLabel id={recentHeadingId}>
                  <ClockCounterClockwiseIcon aria-hidden="true" />
                  {c.recent}
                </SidebarGroupLabel>
                {!loading && recent.length > recentPageSize && (
                  <Button type="button" variant="ghost" size="sm" className="creation-recent-expand"
                    aria-expanded={recentExpanded} aria-controls={recentListId}
                    aria-label={recentExpanded ? c.fewerRecent : c.moreRecent}
                    onClick={() => setRecentExpanded(expanded => !expanded)}>
                    {recentExpanded ? c.fewer : c.more}
                    <CaretDownIcon aria-hidden="true" />
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="creation-nav-skeleton" aria-hidden="true">
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ) : (
                <SidebarMenu id={recentListId}>
                  {recent.slice(0, recentExpanded ? recentPageSize * 2 : recentPageSize).map((deck) => (
                    <SidebarMenuItem key={deck.id}>
                      <SidebarMenuButton render={<a href={`#/deck/${encodeURIComponent(deck.id)}`} onClick={closeNav} />}>
                        <PresentationIcon aria-hidden="true" />
                        <span lang={deck.language}>{deck.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="creation-sidebar-footer">
          <button
            type="button"
            className="creation-guide"
            onClick={() => {
              closeNav();
              setGuideOpen(true);
            }}
          >
            <BookOpenIcon className="creation-guide-icon" />
            <strong>{c.guide}</strong>
            <span>
              {c.openGuide}
              <ArrowRightIcon weight="bold" data-motion-arrow />
            </span>
          </button>
        </SidebarFooter>
      </Sidebar>
      <div className="creation-column">
        <header className="creation-topbar">
          <SidebarTrigger aria-label={c.menu} title={c.menu} />
          <span className="creation-top-rule" aria-hidden="true" />
          <div className="creation-breadcrumb">
            <span>{c.workspace}</span>
            <CaretRightIcon aria-hidden />
            <strong>{current}</strong>
          </div>
          <div className="creation-top-actions">
            {search}
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
        </header>
        <main className="creation-content">{children}</main>
      </div>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogPopup className="creation-guide-dialog" closeProps={{ 'aria-label': t.close }}>
          <DialogHeader>
            <DialogTitle>{c.guide}</DialogTitle>
            <DialogDescription>{c.guideIntro}</DialogDescription>
          </DialogHeader>
          <ol>
            {c.steps.map(([title, description]) => (
              <li key={title}>
                <strong>{title}</strong>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <DialogClose render={<Button variant="outline" />}>{t.close}</DialogClose>
        </DialogPopup>
      </Dialog>
    </>
  );
}

export function StudioNavigation(props: NavigationProps) {
  return (
    <SidebarProvider className="studio-shell creation-shell">
      <NavigationContent {...props} />
    </SidebarProvider>
  );
}

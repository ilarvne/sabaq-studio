import { useState, type ReactElement } from 'react';
import { defaultDirectiveFormatter, useAui } from '@assistant-ui/react';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Menu } from '@base-ui/react/menu';
import { CaretRightIcon } from '@phosphor-icons/react';
import type { AssistantCanvasScope } from '@sabaq/contracts/assistant';
import { numericTableValues } from '@sabaq/lesson/chart-data';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { assistantCopy } from './assistant-copy';
import { canvasTextSelection } from './canvas-selection';
import { useAssistantSession } from './AssistantSession';

export function RewriteSpeechButton({label,disabled,openReview}:{label:string;disabled:boolean;openReview:()=>void}) {
  const {rewriteSpeech,running,deciding}=useAssistantSession();
  return <Button size="sm" variant="outline" disabled={disabled || running || Boolean(deciding)}
    onClick={()=>{openReview();rewriteSpeech();}}>{label}</Button>;
}

export const canvasCopy = {
  en:{label:'Edit with AI',selected:'Edit selected text with AI',shorten:'Shorten',simplify:'Simplify',shortTitle:'Shorten only the title of the selected slide.',
    simpleTitle:'Simplify only the title of the selected slide for grade 7.'},
  ru:{label:'Изменить с ИИ',selected:'Изменить выбранный текст с ИИ',shorten:'Короче',simplify:'Проще',shortTitle:'Сократи только заголовок выбранного слайда.',
    simpleTitle:'Упрости только заголовок выбранного слайда для 7 класса.'},
  kk:{label:'ЖИ көмегімен өзгерту',selected:'Таңдалған мәтінді ЖИ көмегімен өзгерту',shorten:'Қысқарту',simplify:'Жеңілдету',shortTitle:'Таңдалған слайдтың тақырыбын ғана қысқарт.',
    simpleTitle:'Таңдалған слайдтың тақырыбын ғана 7-сыныпқа лайықтап жеңілдет.'},
};

type CanvasTarget = Exclude<AssistantCanvasScope['field'],'object'>;
const canvasActions = {
  en: {example:'Add an example', chart:'Convert to chart', translate:'Translate', custom:'Custom request',
    fields:{title:'the title',body:'the body text',slide:'the slide',object:'the selected object'}, offline:'Requires a configured assistant model.',
    simplerBody:'Simplify only the body text of the selected slide for grade 7. Keep the slide language and the other fields unchanged.',
    numeric:'Requires a table with a label column and numeric values.', chartPrompt:'Convert the numeric data on the selected slide into a chart.',
    examplePrompt:(field:string)=>`Add one concrete example to ${field} of the selected slide. Keep the original language and all other fields unchanged.`,
    translatePrompt:(field:string,language:string)=>`Translate ${field} into ${language} on the selected slide. Preserve the meaning and formatting. Leave any other fields and slides unchanged.`},
  ru: {example:'Добавить пример',chart:'Преобразовать в диаграмму',translate:'Перевести',custom:'Свой запрос',
    fields:{title:'заголовок',body:'основной текст',slide:'весь слайд',object:'выбранный объект'},offline:'Для этого действия нужна настроенная модель помощника.',
    simplerBody:'Упрости только основной текст выбранного слайда для 7 класса. Сохрани язык слайда и остальные поля.',
    numeric:'Нужна таблица с подписями в первом столбце и числами в остальных.',chartPrompt:'Преобразуй числовые данные выбранного слайда в диаграмму.',
    examplePrompt:(field:string)=>`Дополни примером выбранный элемент: ${field}. Сохрани исходный язык и остальные поля слайда.`,
    translatePrompt:(field:string,language:string)=>`Переведи выбранный элемент (${field}) выбранного слайда. Целевой язык: ${language}. Сохрани смысл, оформление и остальные элементы.`},
  kk: {example:'Мысал қосу',chart:'Диаграммаға айналдыру',translate:'Аудару',custom:'Өз сұрауым',
    fields:{title:'тақырып',body:'негізгі мәтін',slide:'бүкіл слайд',object:'таңдалған нысан'},offline:'Бұл әрекетке бапталған көмекші моделі қажет.',
    simplerBody:'Таңдалған слайдтың негізгі мәтінін ғана 7-сыныпқа лайықтап жеңілдет. Слайдтың тілін және қалған өрістерін сақта.',
    numeric:'Бірінші бағанында атаулар, қалған бағандарында сандар бар кесте қажет.',chartPrompt:'Таңдалған слайдтағы сандық деректерді диаграммаға айналдыр.',
    examplePrompt:(field:string)=>`Таңдалған слайдтың осы бөлігіне (${field}) бір нақты мысал қос. Бастапқы тілді және басқа өрістерді сақта.`,
    translatePrompt:(field:string,language:string)=>`Таңдалған слайдтың осы бөлігін аудар: ${field}. Аударма тілі: ${language}. Мағынасын, пішімін және қалған элементтерді сақта.`},
};
const targets: Record<Locale, string> = {kk:'Қазақша',ru:'Русский',en:'English'};

export function ShortenOverflowButton({ field, openReview }: { field: 'title' | 'body'; openReview: () => void }) {
  const { locale, running, deciding, slide, editCanvas, canGenerateEdits } = useAssistantSession();
  const label = { en: 'Shorten with AI', ru: 'Сократить с ИИ', kk: 'ЖИ көмегімен қысқарту' }[locale];
  const { fields, offline } = canvasActions[locale];
  const unavailable = field === 'title' && !canGenerateEdits;
  return <Button type="button" size="sm" variant="outline" aria-description={unavailable ? offline : fields[field]}
    title={unavailable ? offline : undefined} disabled={running || Boolean(deciding) || unavailable || slide.status !== 'ready'}
    onClick={() => {
      openReview();
      editCanvas(field === 'title' ? canvasCopy[locale].shortTitle : assistantCopy[locale].shortenPrompt,{field});
    }}>{label}</Button>;
}

const objectCommands = {
  en:{shorter:'Shorten the selected text box while keeping its meaning.',simpler:'Simplify the selected text box for grade 7.'},
  ru:{shorter:'Сократи текст выбранного объекта, сохранив смысл.',simpler:'Упрости текст выбранного объекта для 7 класса.'},
  kk:{shorter:'Таңдалған мәтін жолағын мағынасын сақтап қысқарт.',simpler:'Таңдалған мәтін жолағын 7-сыныпқа лайықтап жеңілдет.'},
};

function CanvasCommands({scope,objectText,openReview}: {scope:AssistantCanvasScope;objectText?:boolean;openReview:()=>void}) {
  const {locale,deck,slide,running,deciding,editCanvas,canGenerateEdits} = useAssistantSession();
  const aui=useAui();
  const labels=canvasCopy[locale], actions=canvasActions[locale], text=assistantCopy[locale];
  const {field,selection}=scope;
  const onObject=field==='object';
  const busy=running || Boolean(deciding) || slide.status!=='ready';
  const table=slide.table;
  const canChart=Boolean(numericTableValues(table));
  const itemClass='as-canvas-action';
  function request(prompt:string, targetScope:AssistantCanvasScope=scope) { openReview(); editCanvas(prompt,targetScope); }
  function custom() {
    openReview();
    const composer=aui.composer(), index=deck.slides.findIndex(item=>item.id===slide.id)+1;
    const mention=defaultDirectiveFormatter.serialize({type:'slide',id:slide.id,label:`${locale==='en'?'Slide':'Слайд'} ${index}`});
    const config=composer.getState().runConfig;
    composer.setRunConfig({...config,custom:{...config.custom,webResearch:undefined,canvasContext:{slideId:slide.id,scope}}});
    composer.setText(`${mention} · ${actions.fields[field]} — ${composer.getState().text}`);
    requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.lesson-assistant .as-composer textarea')?.focus());
  }
  return <>
    {(!onObject || objectText) && <>
    <Menu.Item className={itemClass} disabled={busy || ((onObject || field==='title' || Boolean(selection)) && !canGenerateEdits)}
      title={(onObject || field==='title' || selection) && !canGenerateEdits ? actions.offline : undefined}
      onClick={()=>request(onObject ? objectCommands[locale].shorter : field==='title' ? labels.shortTitle : text.shortenPrompt)}>
      {labels.shorten}
    </Menu.Item>
    <Menu.Item className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}
      onClick={()=>request(onObject ? objectCommands[locale].simpler : field==='title' ? labels.simpleTitle : field==='body' ? actions.simplerBody : text.simplerPrompt)}>{labels.simplify}</Menu.Item>
    <Menu.Item className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}
      onClick={()=>request(field==='slide' ? text.examplePrompt : actions.examplePrompt(actions.fields[field]))}>{actions.example}</Menu.Item>
    {!onObject && <Menu.Item className={itemClass} disabled={busy || !canChart} title={!canChart ? actions.numeric : undefined}
      onClick={()=>request(actions.chartPrompt,{field:'slide'})}>{actions.chart}</Menu.Item>}
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={itemClass} disabled={busy || !canGenerateEdits} title={!canGenerateEdits ? actions.offline : undefined}>
        {actions.translate}<CaretRightIcon aria-hidden size={13}/>
      </Menu.SubmenuTrigger>
      <Menu.Portal><Menu.Positioner className="as-canvas-positioner" sideOffset={3}>
        <Menu.Popup className="as-canvas-actions" aria-label={actions.translate}>
          {(Object.entries(targets) as [Locale,string][]).map(([language,name])=><Menu.Item key={language} className={itemClass}
            lang={language} onClick={()=>request(actions.translatePrompt(actions.fields[field],new Intl.DisplayNames([locale],{type:'language'}).of(language) ?? name))}>
            {name}
          </Menu.Item>)}
        </Menu.Popup>
      </Menu.Positioner></Menu.Portal>
    </Menu.SubmenuRoot>
    <Menu.Separator className="as-canvas-divider"/>
    </>}
    <Menu.Item className={itemClass} disabled={busy || (onObject && !canGenerateEdits)}
      title={onObject && !canGenerateEdits ? actions.offline : undefined} onClick={custom}>{actions.custom}</Menu.Item>
  </>;
}

export function CanvasAssistantMenu({trigger,field,openReview}: {trigger:ReactElement;field:'title'|'body';openReview:()=>void}) {
  const {locale,slide}=useAssistantSession();
  const [selection,setSelection]=useState<AssistantCanvasScope['selection']>();
  return <ContextMenu.Root><ContextMenu.Trigger render={trigger}
    onContextMenu={event=>setSelection(canvasTextSelection(event.currentTarget,slide[field]))}/>
    <ContextMenu.Portal><ContextMenu.Positioner className="as-canvas-positioner">
      <ContextMenu.Popup className="as-canvas-actions" aria-label={selection ? canvasCopy[locale].selected : canvasCopy[locale].label}>
        <CanvasCommands scope={{field,selection}} openReview={openReview}/>
      </ContextMenu.Popup>
    </ContextMenu.Positioner></ContextMenu.Portal>
  </ContextMenu.Root>;
}

export function CanvasAssistantDropdown({trigger,field='slide',selection,object,openReview}: {
  trigger:ReactElement;field?:CanvasTarget;selection?:AssistantCanvasScope['selection'];
  object?:{id:string;kind:string};openReview:()=>void;
}) {
  const {locale,deck,slide}=useAssistantSession();
  const scope:AssistantCanvasScope=object
    ? {field:'object',objectId:object.id,version:slide.version,theme:deck.theme}
    : {field,selection};
  return <Menu.Root><Menu.Trigger render={trigger}/>
    <Menu.Portal><Menu.Positioner className="as-canvas-positioner" align="end" sideOffset={5}>
      <Menu.Popup className="as-canvas-actions" aria-label={canvasCopy[locale].label}>
        <CanvasCommands scope={scope} objectText={object?.kind==='text'} openReview={openReview}/>
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}

export function useCanvasProposal() {
  const {selectedProposal, slide, deck} = useAssistantSession();
  if (!selectedProposal || (selectedProposal.baseRevision !== undefined && selectedProposal.baseRevision !== deck.revision)) return;
  const change = selectedProposal.changes?.find(item => item.slideId === slide.id);
  if (change?.after || selectedProposal.themes) return {id: selectedProposal.id, slide: change?.after ?? slide,
    theme: selectedProposal.themes?.after ?? deck.theme};
}

import { createContext, useEffect, useState } from 'react';
import { brandContrast } from '@sabaq/lesson/themes';
import { brandFonts, type Deck, type Locale, type OrganizationAsset, type OrganizationBrand, type OrganizationTemplate } from '@sabaq/lesson/types';
import { ApiError, request } from '@/lib/api';
import { Button } from '@/components/coss/button';
import { Input } from '@/components/coss/input';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/coss/dialog';
import { OptionSelect } from '@/components/OptionSelect';
import { languages } from '@/copy';
import { TrashIcon } from '@phosphor-icons/react';
import './organization.css';

const copy={
  en:{templates:'Organization templates',settings:'Organization style and media',style:'Style for new lessons',paper:'Background',ink:'Text and graphics',font:'Font',logo:'Logo',none:'No logo',assets:'Organization images',upload:'Upload image or logo',remove:'Remove from library',save:'Save style',saved:'Style saved',contrast:'Text contrast must reach 4.5:1.',failed:'The change could not be saved. Try again.',load:'Could not load the organization library.',retry:'Retry',close:'Close',use:'Create a copy',name:'Lesson title',slides:'slides',publish:'Save organization template',notice:'The template shares slides, images and speaker notes with your organization. Saving under the same name replaces the catalog entry for future copies.',templateName:'Template name',published:'Template published',styleFirst:'Save an organization style from the template catalog first.',missing:'Change the title or reopen the catalog and try again.',limit:'Choose a single PNG, JPEG or WebP up to 10 MB.'},
  ru:{templates:'Шаблоны организации',settings:'Стиль и медиатека организации',style:'Стиль новых презентаций',paper:'Фон',ink:'Текст и графика',font:'Шрифт',logo:'Логотип',none:'Без логотипа',assets:'Изображения организации',upload:'Загрузить изображение или логотип',remove:'Убрать из медиатеки',save:'Сохранить стиль',saved:'Стиль сохранён',contrast:'Контраст текста должен быть не менее 4,5:1.',failed:'Не удалось сохранить изменение. Повторите попытку.',load:'Не удалось загрузить медиатеку организации.',retry:'Повторить',close:'Закрыть',use:'Создать копию',name:'Название презентации',slides:'слайдов',publish:'Сохранить шаблон организации',notice:'Слайды, изображения и заметки станут доступны организации. Сохранение под прежним именем обновит шаблон для будущих копий.',templateName:'Название шаблона',published:'Шаблон опубликован',styleFirst:'Сначала сохраните стиль организации в каталоге шаблонов.',missing:'Проверьте название или откройте каталог заново.',limit:'Выберите один файл PNG, JPEG или WebP до 10 МБ.'},
  kk:{templates:'Ұйым үлгілері',settings:'Ұйымның стилі мен медиатекасы',style:'Жаңа таныстырылымдардың стилі',paper:'Фон',ink:'Мәтін және графика',font:'Қаріп',logo:'Логотип',none:'Логотипсіз',assets:'Ұйым суреттері',upload:'Сурет немесе логотип жүктеу',remove:'Медиатекадан алып тастау',save:'Стильді сақтау',saved:'Стиль сақталды',contrast:'Мәтін контрасты кемінде 4,5:1 болуы тиіс.',failed:'Өзгеріс сақталмады. Қайталап көріңіз.',load:'Ұйым медиатекасы жүктелмеді.',retry:'Қайталау',close:'Жабу',use:'Көшірме жасау',name:'Таныстырылым атауы',slides:'слайд',publish:'Ұйым үлгісін сақтау',notice:'Слайдтар, суреттер және баяндамашы жазбалары ұйымға қолжетімді болады. Сол атаумен сақтау келешек көшірмелерге арналған үлгіні жаңартады.',templateName:'Үлгі атауы',published:'Үлгі жарияланды',styleFirst:'Алдымен үлгілер каталогында ұйым стилін сақтаңыз.',missing:'Атауды тексеріңіз немесе каталогты қайта ашыңыз.',limit:'10 МБ-ға дейінгі бір PNG, JPEG немесе WebP файлын таңдаңыз.'},
};
export const organizationWords=copy;
export const OrganizationMember=createContext(false);
type Library={admin:boolean;brand:OrganizationBrand|null;templates:OrganizationTemplate[];assets:OrganizationAsset[]};

function useLibrary() {
  const [library,set]=useState<Library>(),[error,setError]=useState(false),[version,reload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setError(false);
    void request<Library>('/organization',{signal:controller.signal}).then(set).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[version]);
  return {library,error,reload:()=>reload(v=>v+1)};
}

export function OrganizationImagePicker({locale,choose}:{locale:Locale;choose:(asset:OrganizationAsset)=>void}) {
  const {library,error,reload}=useLibrary(),t=copy[locale];
  if(error)return <div role="alert">{t.load} <Button variant="ghost" onClick={reload}>{t.retry}</Button></div>;
  if (!library?.assets.length)return null;
  return <details><summary>{t.assets}</summary><div className="mt-2 grid grid-cols-3 gap-2">
    {library.assets.map(asset=><button type="button" key={asset.id} className="rounded border p-1" onClick={()=>choose(asset)}>
      <img src={asset.src} alt="" className="h-12 w-full object-contain"/>{asset.name}
    </button>)}</div></details>;
}

function BrandSettings({library,locale,reload,close}:{library:Library;locale:Locale;reload:()=>void;close:()=>void}) {
  const t=copy[locale];
  const [brand,setBrand]=useState<OrganizationBrand>(library.brand ?? {paper:'#ffffff',ink:'#173e32',font:brandFonts[0]});
  const [logo,setLogo]=useState(library.assets.find(asset=>asset.src===library.brand?.logo)?.id ?? '');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const selected=library.assets.find(asset=>asset.id===logo);
  const ratio=brandContrast(brand.paper,brand.ink);
  async function run(work:()=>Promise<void>) {
    setBusy(true);setMessage('');
    try{await work();reload();}catch(e){setMessage(e instanceof ApiError && [413,415].includes(e.status)?t.limit:t.failed);}
    finally{setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogPopup className="organization-dialog organization-brand" closeProps={{'aria-label':t.close}}><DialogHeader><DialogTitle>{t.settings}</DialogTitle><DialogDescription>{t.style}</DialogDescription></DialogHeader>
    <DialogPanel><fieldset disabled={busy} className="grid gap-4">
      <div className="organization-fields">{(['paper','ink'] as const).map(key=><label key={key}>{t[key]}<span className="organization-color"><input type="color" aria-label={t[key]} value={brand[key]} onChange={e=>setBrand({...brand,[key]:e.target.value})}/><code aria-hidden="true">{brand[key]}</code></span></label>)}</div>
      <div className="organization-fields"><label>{t.font}<OptionSelect label={t.font} value={brand.font} options={brandFonts.map(value=>({value,label:value.replace(' Variable','')}))} onChange={font=>setBrand({...brand,font})}/></label>
      <label>{t.logo}<OptionSelect label={t.logo} value={selected?.id ?? 'none'} options={[{value:'none',label:t.none},...library.assets.map(a=>({value:a.id,label:a.name}))]} onChange={setLogo}/></label></div>
      <div className="organization-sample" style={{fontFamily:brand.font,color:brand.ink,background:brand.paper}}>
        <div><strong>{t.style}</strong><small>{ratio.toFixed(2)}:1</small></div>{selected && <img src={selected.src} alt={t.logo} className="max-h-9 max-w-20 object-contain"/>}</div>
      {ratio<4.5 && <p role="alert">{t.contrast}</p>}
      <Button disabled={ratio<4.5} onClick={()=>void run(async()=>{await request('/organization/brand',{method:'PUT',body:{paper:brand.paper,ink:brand.ink,font:brand.font,logoId:selected?.id}});setMessage(t.saved);})}>{t.save}</Button>
      <label className="organization-upload">{t.upload}<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{
        const file=e.target.files?.[0];e.target.value='';if(!file)return;
        if (file.size>10_000_000){setMessage(t.limit);return;}
        void run(async()=>{const response=await fetch('/api/organization/media?'+new URLSearchParams({name:file.name.slice(0,120)}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
          if(!response.ok)throw new ApiError(response.status,{});});
      }}/></label>
      {library.assets.map(a=><div key={a.id} className="organization-asset"><img src={a.src} alt="" className="h-10 w-12 object-contain"/>
        <span className="grow">{a.name}</span><Button variant="outline" size="sm" aria-label={t.remove+' · '+a.name} title={t.remove} onClick={()=>void run(async()=>{await request('/organization/media/'+a.id,{method:'DELETE'});})}><TrashIcon aria-hidden/></Button></div>)}
    </fieldset><p role="status">{message}</p></DialogPanel><DialogFooter><Button variant="outline" onClick={close}>{t.close}</Button></DialogFooter></DialogPopup></Dialog>;
}

export function OrganizationTemplates({locale}:{locale:Locale}) {
  const {library,error,reload}=useLibrary(),t=copy[locale];
  const [settings,setSettings]=useState(false),[selection,setSelection]=useState<OrganizationTemplate>(),[title,setTitle]=useState('');
  const [requestId,setId]=useState(''),[busy,setBusy]=useState(false),[failed,fail]=useState(false);
  if(error)return <div role="alert">{t.load} <Button variant="ghost" onClick={reload}>{t.retry}</Button></div>;
  if(!library || !library.admin && !library.templates.length)return null;
  return <section className="grid gap-3 rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2>{t.templates}</h2>
    {library.admin && <Button variant="outline" onClick={()=>setSettings(true)}>{t.settings}</Button>}</div>
    {library.templates.map(item=><div className="flex flex-wrap items-center justify-between gap-2" key={item.id}><span>{item.name} · {languages[item.language]} · {item.slideCount} {t.slides}</span>
      <Button variant="outline" onClick={()=>{setSelection(item);setTitle(item.name);setId(crypto.randomUUID());fail(false);}}>{t.use}</Button></div>)}
    {settings && <BrandSettings library={library} locale={locale} reload={reload} close={()=>setSettings(false)}/>}
    {selection && <Dialog open onOpenChange={open=>{if(!open && !busy)setSelection(undefined);}}><DialogPopup className="organization-dialog" closeProps={{'aria-label':t.close}}><DialogHeader><DialogTitle>{t.use}</DialogTitle><DialogDescription>{selection.name}</DialogDescription></DialogHeader>
      <DialogPanel><label>{t.name}<Input maxLength={120} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);setId(crypto.randomUUID());}}/></label>{failed && <p role="alert">{t.missing}</p>}</DialogPanel>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setSelection(undefined)}>{t.close}</Button><Button disabled={busy || !title.trim()} onClick={async()=>{
        setBusy(true);fail(false);
        try {const deck=await request<Deck>('/organization/templates/'+selection.id+'/copies',{method:'POST',body:{title:title.trim(),requestId}});location.hash='/deck/'+deck.id;}
        catch{fail(true);}finally{setBusy(false);}
      }}>{t.use}</Button></DialogFooter></DialogPopup></Dialog>}
  </section>;
}

export function OrganizationPublisher({deck,locale,close}:{deck:Deck;locale:Locale;close:()=>void}) {
  const t=copy[locale],[name,setName]=useState(deck.title),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogPopup className="organization-dialog" closeProps={{'aria-label':t.close}}><DialogHeader><DialogTitle>{t.publish}</DialogTitle><DialogDescription>{t.notice}</DialogDescription></DialogHeader>
    <DialogPanel><label>{t.templateName}<Input value={name} maxLength={120} onChange={e=>{setName(e.target.value);setStatus('');}}/></label><p role="status">{status}</p></DialogPanel>
    <DialogFooter><Button variant="outline" onClick={close}>{t.close}</Button><Button disabled={busy || !name.trim() || status===t.published} onClick={async()=>{
      setBusy(true);setStatus('');
      try {await request('/organization/templates',{method:'POST',body:{deckId:deck.id,revision:deck.revision,name}});setStatus(t.published);}
      catch(e){setStatus(e instanceof ApiError && e.status===409 && e.message.includes('style')?t.styleFirst:t.failed);}finally{setBusy(false);}
    }}>{t.publish}</Button></DialogFooter></DialogPopup></Dialog>;
}

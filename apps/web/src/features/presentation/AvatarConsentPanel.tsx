import {useState} from 'react';
import type {AvatarConsent} from '@sabaq/contracts/video';
import type {Locale} from '@sabaq/lesson/types';
import {Button} from '@/components/coss/button';
import {request} from '@/lib/api';

const words={
  en:{title:'My avatar and voice',policy:'Consent version',agree:'I consent to the regional operator processing my face and voice samples to create an avatar for my lecture videos.',enroll:'Start enrollment',portal:'Open the operator’s enrollment page',refresh:'Check status',erase:'Delete my samples, avatar and recordings',confirm:'Confirm deletion',cancel:'Cancel',active:'Your avatar is active.',enrolling:'Enrollment is pending.',deleting:'Access is revoked. Deletion is pending.',deleted:'The operator confirmed deletion.',failed:'The biometric operator could not complete this request. Try again.'},
  ru:{title:'Мой аватар и голос',policy:'Версия согласия',agree:'Я даю согласие региональному оператору на обработку образцов моего лица и голоса для создания аватара моих видеолекций.',enroll:'Начать регистрацию',portal:'Перейти к регистрации у оператора',refresh:'Проверить статус',erase:'Удалить мои образцы, аватар и видеозаписи',confirm:'Подтвердить удаление',cancel:'Отмена',active:'Аватар активен.',enrolling:'Регистрация не завершена.',deleting:'Доступ отозван. Идёт удаление.',deleted:'Оператор подтвердил удаление.',failed:'Оператор не смог выполнить запрос. Повторите попытку.'},
  kk:{title:'Менің аватарым мен дауысым',policy:'Келісім нұсқасы',agree:'Дәріс бейнелеріме аватар жасау үшін өңірлік оператордың бетім мен дауысымның үлгілерін өңдеуіне келісім беремін.',enroll:'Тіркелуді бастау',portal:'Оператордың тіркеу бетін ашу',refresh:'Күйін тексеру',erase:'Үлгілерімді, аватарымды және бейнежазбаларымды жою',confirm:'Жоюды растау',cancel:'Бас тарту',active:'Аватар белсенді.',enrolling:'Тіркелу аяқталмады.',deleting:'Қолжетімділік тоқтатылды. Жою орындалуда.',deleted:'Оператор жойылғанын растады.',failed:'Оператор сұрауды орындай алмады. Қайта көріңіз.'},
};
export function AvatarConsentPanel({initial,locale,changed}:{initial:AvatarConsent;locale:Locale;changed:(value:AvatarConsent)=>void}){
  const t=words[locale];
  const [agree,setAgree]=useState(false),[confirm,setConfirm]=useState(false),[portal,setPortal]=useState(''),
    [busy,setBusy]=useState(false),[error,setError]=useState(false);
  const state=initial.state;
  async function run(action:'enroll'|'refresh'|'delete') {
    if(busy)return;
    setBusy(true);setError(false);
    try{
      if(action==='enroll'){
        const result=await request<{enrollmentUrl:string}>('/biometrics/self/enrollment',{method:'POST',body:{consent:agree,policy:initial.policy}});
        setPortal(result.enrollmentUrl);changed({...initial,state:'enrolling'});setAgree(false);
      }else{
        const result=await request<AvatarConsent>('/biometrics/self',{method:action==='delete'?'DELETE':'GET'});
        changed(result);setConfirm(false);if(result.state!=='enrolling')setPortal('');
      }
    }catch{setError(true);}finally{setBusy(false);}
  }
  if(!initial.configured && ['none','deleted'].includes(state))return null;
  return <details className="rv-avatar-consent"><summary>{t.title}</summary><div className="grid gap-2 p-2">
    {state!=='none' && <p role="status">{t[state]}</p>}
    {initial.configured && ['none','deleted','enrolling'].includes(state) && <>
      <label><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/> {t.agree}</label>
      <span>{t.policy} · {initial.policy}</span>
      <Button disabled={busy || !agree} onClick={()=>void run('enroll')}>{t.enroll}</Button>
      {portal && <a target="_blank" rel="noopener noreferrer" href={portal}>{t.portal}</a>}
    </>}
    {state!=='none' && <Button variant="outline" disabled={busy} onClick={()=>void run('refresh')}>{t.refresh}</Button>}
    {['active','enrolling'].includes(state) && (confirm ? <>
      <Button disabled={busy} onClick={()=>void run('delete')}>{t.confirm}</Button>
      <Button variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>{t.cancel}</Button>
    </> : <Button variant="outline" onClick={()=>setConfirm(true)}>{t.erase}</Button>)}
    {error && <p role="alert">{t.failed}</p>}
  </div></details>;
}

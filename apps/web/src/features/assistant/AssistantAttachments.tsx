import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiState, type Attachment, type AttachmentAdapter, type DataMessagePart } from '@assistant-ui/react';
import type { SourceFile } from '@sabaq/contracts/source-files';
import { XIcon } from '@phosphor-icons/react';
import type { Locale } from '@sabaq/lesson/types';
import { Button } from '@/components/coss/button';
import { sourceFileAccept, uploadSourceFile } from '@/features/sources/source-api';
import { SourceFilePicker } from '@/features/sources/SourceFilePicker';
import { SourceFileIcon } from '@/features/sources/SourceFileIcon';

export const maxAssistantAttachments = 2;
const copy = {
  en:{remove:'Remove attachment', reading:'Saving to My files…', saved:'Saved in My files',
    decode:'Could not save this file. Choose a readable document of a supported format.',
    limit:'Attach up to two documents.', prompt:'Summarize the key points in the attached material.'},
  ru:{remove:'Удалить вложение', reading:'Сохраняем в «Мои файлы»…', saved:'Сохранён в «Моих файлах»',
    decode:'Не удалось сохранить файл. Выберите читаемый документ поддерживаемого формата.',
    limit:'Можно прикрепить до двух документов.', prompt:'Кратко изложи основные мысли из прикреплённых материалов.'},
  kk:{remove:'Тіркемені жою', reading:'«Менің файлдарым» бөліміне сақталып жатыр…', saved:'«Менің файлдарым» бөлімінде сақталған',
    decode:'Файл сақталмады. Қолдау көрсетілетін пішімдегі, мәтіні оқылатын құжатты таңдаңыз.',
    limit:'Екі құжатқа дейін тіркеуге болады.', prompt:'Тіркелген материалдағы негізгі ойларды қысқаша түйінде.'},
};

export const assistantAttachmentCopy = copy;

function sourcePart(file: SourceFile): DataMessagePart<SourceFile> {
  return {type:'data', name:'library-source', data:file};
}

export function attachmentSource(attachment: Attachment): SourceFile | undefined {
  const part = attachment.content?.find(part=>part.type==='data' && part.name==='library-source');
  return part?.type==='data' ? part.data as SourceFile : undefined;
}

export function createAssistantAttachmentAdapter(locale: Locale, allowScans = false): AttachmentAdapter {
  const pending = new Map<string, AbortController>();
  return {
    accept:sourceFileAccept(allowScans) + ',text/plain',
    async *add({file}) {
      const base = {id:crypto.randomUUID(),type:'document',name:file.name.trim().slice(0,160),file};
      const controller = new AbortController();
      pending.set(base.id, controller);
      try {
        yield {...base,status:{type:'running',reason:'uploading',progress:0}};
        const source = await uploadSourceFile(file, locale, allowScans, controller.signal);
        if (controller.signal.aborted) return;
        yield {...base,name:source.name,status:{type:'requires-action',reason:'composer-send'},content:[sourcePart(source)]};
      } catch {
        if (!controller.signal.aborted) yield {...base,status:{type:'incomplete',reason:'error',message:copy[locale].decode}};
      } finally {
        pending.delete(base.id);
      }
    },
    async send(attachment) {
      const {file:_file,...metadata} = attachment;
      return {...metadata,status:{type:'complete'},content:attachment.content ?? []};
    },
    async remove(attachment) { pending.get(attachment.id)?.abort(); },
  };
}

function AttachmentChip({locale}: {locale:Locale}) {
  const attachment = useAuiState(state=>state.attachment);
  const t = copy[locale];
  const state = attachment.status.type;
  const error = attachment.status.type==='incomplete' ? attachment.status.message : undefined;
  const source = attachmentSource(attachment);
  return <AttachmentPrimitive.Root className="as-file" data-status={state}>
    <SourceFileIcon format={source?.format}/>
    <div className="as-file-copy">
      <span className="as-file-name" title={attachment.name}><AttachmentPrimitive.Name /></span>
      {state==='running' && <small role="status">{t.reading}</small>}
      {source && <small>{t.saved}</small>}
      {error && <small role="alert">{error}</small>}
    </div>
    <AttachmentPrimitive.Remove render={<Button size="icon-xs" variant="ghost"/>}
      aria-label={t.remove+' · '+attachment.name} title={t.remove}><XIcon/></AttachmentPrimitive.Remove>
  </AttachmentPrimitive.Root>;
}

export function AssistantComposerFiles({locale}: {locale:Locale}) {
  return <div className="as-files">
    <ComposerPrimitive.Attachments>{()=> <AttachmentChip locale={locale}/>}</ComposerPrimitive.Attachments>
  </div>;
}

export function AssistantSourcePicker({locale, disabled, onSearchAll, allowScans, className}: {
  locale:Locale; disabled:boolean; onSearchAll?:()=>void; allowScans?:boolean; className?:string;
}) {
  const aui = useAui();
  const attachments = useAuiState(state=>state.composer.attachments);
  const limit = maxAssistantAttachments - attachments.length;
  return <SourceFilePicker locale={locale} disabled={disabled || limit<=0} iconOnly limit={limit} allowScans={allowScans} className={className}
    exclude={attachments.flatMap(attachment=>{const source=attachmentSource(attachment);return source ? [source.id] : [];})}
    onSearchAll={attachments.length ? undefined : onSearchAll}
    onSelect={files=>{
      for (const file of files) {
        void aui.composer().addAttachment({id:file.id,type:'document',name:file.name,contentType:'text/plain',content:[sourcePart(file)]}).catch(()=>undefined);
      }
    }}/>;
}

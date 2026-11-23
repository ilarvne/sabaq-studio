import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { powerPointStyleInput } from '@sabaq/contracts/schema';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import { documentRuns } from '@sabaq/lesson/rich-text';
import type { RichRun, Slide } from '@sabaq/lesson/types';
import type { JSONContent } from '@tiptap/core';
import { ApiError } from '../errors';

const reader = fileURLToPath(new URL('./extract_pptx.py', import.meta.url));
const notes = z.string().max(20_000);
const block = z.array(z.array(z.object({text:z.string(),bold:z.boolean().optional(),italic:z.boolean().optional()})));
const parsedSlides = z.array(z.discriminatedUnion('editable',[
  z.object({editable:z.literal(false),notes}),
  z.object({
    editable:z.literal(true),
    title:block,
    body:block,
    notes,
    table:z.object({headers:z.array(z.string()),rows:z.array(z.array(z.string()))}).optional(),
    positioned:z.array(z.object({
      id:z.enum(['title','body','image','table']),x:z.number().min(0).max(100),y:z.number().min(0).max(100),
      w:z.number().positive().max(100.00001),h:z.number().positive().max(100.00001),rotation:z.literal(0),
    })).min(1).max(4).optional(),
    picture:z.object({alt:z.string().max(2000),side:z.enum(['left','right'])}).optional(),
  }),
])).min(1).max(40);

type ExtractedSlide =
  | {notes:string; editable:false}
  | {notes:string; editable:true; slide:Omit<Slide,'id'|'status'|'version'|'lessonPart'>; picture?:{path:string;alt:string}};

function richDocument(paragraphs: RichRun[][]): JSONContent {
  return {
    type:'doc',
    content:paragraphs.map(runs => ({
      type:'paragraph',
      content:runs.flatMap(run => run.text.split('\n').flatMap((text,index) => {
        const marks = [
          ...(run.bold ? [{type:'bold'}] : []),
          ...(run.italic ? [{type:'italic'}] : []),
        ];
        const nodes:JSONContent[] = index > 0 ? [{type:'hardBreak'}] : [];
        if (text) nodes.push({type:'text',text,...(marks.length && {marks})});
        return nodes;
      })),
    })),
  };
}

async function normalizePicture(input: string, output: string) {
  const image = sharp(input,{limitInputPixels:16_000_000,failOn:'warning'});
  const metadata = await image.metadata();
  if (!['png','jpeg','webp'].includes(metadata.format) || (metadata.pages ?? 1)>1) return;
  await image.autoOrient().resize(1920,1080,{fit:'inside',withoutEnlargement:true}).png().toFile(output);
  return true;
}

export async function extractEditablePptx(
  job: string,
  convert: (job:string,command:string,args:string[]) => Promise<string>,
): Promise<ExtractedSlide[]> {
  await copyFile(reader,join(job,'extract_pptx.py'));
  await convert(job,'python3',['-I','extract_pptx.py']);
  const metadataPath = join(job,'editable.json');
  if ((await stat(metadataPath)).size > 8_000_000) throw new ApiError(422,'The presentation contains too much editable text.');
  const result = parsedSlides.safeParse(JSON.parse(await readFile(metadataPath,'utf8')));
  if (!result.success) throw new ApiError(422,'This PowerPoint file could not be read.');
  const slides:ExtractedSlide[] = [];
  for (const [index,source] of result.data.entries()) {
    if (!source.editable) {
      slides.push(source);
      continue;
    }
    const titleDoc = richDocument(source.title);
    const bodyDoc = richDocument(source.body);
    const title = documentRuns(titleDoc).map(run => run.text).join('');
    const bodyRuns = documentRuns(bodyDoc);
    const body = bodyRuns.map(run => run.text).join('');
    let picture: {path:string;alt:string} | undefined;
    if (source.picture) {
      const base = join(job,'editable-image-'+(index+1));
      const path = base+'.png';
      if (!await normalizePicture(base+'.bin',path).catch(() => undefined)) {
        slides.push({editable:false,notes:source.notes});
        continue;
      }
      picture = {path,alt:source.picture.alt};
    }
    slides.push({
      notes:source.notes,
      editable:true,
      slide:{title,body,bodyRuns,notes:source.notes,
        richText:{...(title && {title:titleDoc}),...(body && {body:bodyDoc})},
        freeLayout:source.positioned ? {items:source.positioned} : undefined,
        layout:source.table ? 'native-table' : source.picture ? `image-${source.picture.side}` : 'body',
        ...(source.table && {table:source.table})},
      picture,
    });
  }
  return slides;
}


export async function extractPowerPointStyle(bytes:Buffer, convert:(job:string,command:string,args:string[])=>Promise<string>) {
  if (!bytes.length || bytes.length>20_000_000) throw new ApiError(413,'Choose a PowerPoint file up to 20 MB.');
  if (!bytes.subarray(0,2).equals(Buffer.from('PK'))) throw new ApiError(422,'Choose a PPTX theme file.');
  const job=await mkdtemp(join(tmpdir(),'sabaq-template-'));
  try {
    await writeFile(join(job,'source.pptx'),bytes,{mode:0o600});
    await copyFile(reader,join(job,'extract_pptx.py'));
    await convert(job,'python3',['-I','extract_pptx.py','--template']);
    const file=join(job,'template.json');
    if ((await stat(file)).size>65536) throw new ApiError(422,'The template style is too large.');
    const result=powerPointStyleInput.safeParse(JSON.parse(await readFile(file,'utf8')));
    if (!result.success) throw new ApiError(422,'Unsupported PowerPoint theme.');
    return result.data;
  } finally {await rm(job,{recursive:true,force:true});}
}

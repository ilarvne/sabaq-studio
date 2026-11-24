import { displaySlide } from '@sabaq/lesson/typography';
import { documentRuns } from '@sabaq/lesson/rich-text';
import { lessonPartLabel } from '@sabaq/slide-renderer/copy';
import { effectiveFreeLayout, freeImageIds, hasFreePhotoBackground } from '@sabaq/lesson/free-layout';
import { applyPowerPointDecorations, arrangePowerPointShapes, canReadVisibleTitleFirst, decorativePowerPointName,
  describeNativePowerPointDiagram } from './powerpoint-layout';
import { diagramDescription, diagramGeometry, diagramNames } from '@sabaq/lesson/diagram';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { JSONContent } from '@tiptap/core';
import { lessonPalette, powerPointVisualStyle, presentationCoverArtwork, templateFont } from '@sabaq/lesson/themes';
import { isSlideSymbol, slideImages, type Deck, type RichRun, type Slide, type SlideImage } from '@sabaq/lesson/types';
import { generatedImageName } from './visuals';

const wide = { w: 13.333, h: 7.5 };
const margin = .62;
const officeLocale = { kk:'kk-KZ', ru:'ru-RU', en:'en-US' };
const answerLabel = { kk:'Жауап', ru:'Ответ', en:'Answer' };
const slideLabel = { kk:'Слайд', ru:'Слайд', en:'Slide' };
const color = (hex:string) => hex.replace(/^#/, '').toUpperCase();

type Box = {x:number;y:number;w:number;h:number};
type NativeSlide = ReturnType<PptxGenJS['addSlide']>;
type NativeText = string | PptxGenJS.TextProps[];
export type MediaRoots = {catalog:string;generated:string};

function nativeRuns(runs: RichRun[]): PptxGenJS.TextProps[] {
  return runs.map(run => ({
    text: run.text,
    options: {
      bold:run.bold, italic:run.italic,
      ...(run.href&&/^(https?:|mailto:)/i.test(run.href)&&{hyperlink:{url:run.href}}),
    },
  }));
}

function nativeBody(slide: Slide): NativeText {
  if (!slide.bodyRuns?.length || slide.bodyRuns.map(run => run.text).join('') !== slide.body) return slide.body;
  return nativeRuns(slide.bodyRuns);
}

function nativeTitle(original: Slide, displayed: Slide): NativeText {
  const source = original.richText?.title as JSONContent | undefined;
  const paragraphs = (displayed.richText?.title as JSONContent | undefined)?.content;
  if (source?.type !== 'doc' || !paragraphs?.length ||
      documentRuns(source).map(run => run.text).join('') !== original.title) return displayed.title;

  const defaultAlign = !displayed.freeLayout && displayed.layout === 'centered' ? 'center' : 'left';
  return paragraphs.flatMap(paragraph => {
    const requested = paragraph.attrs?.textAlign;
    const align = requested === 'left' || requested === 'center' || requested === 'right' || requested === 'justify'
      ? requested : defaultAlign;
    const runs = nativeRuns(documentRuns(paragraph));
    if (!runs.length || runs.at(-1)?.text === '\n') runs.push({ text: '' });
    return runs.map((run, index) => ({
      text: run.text === '\n' ? '' : run.text,
      options: { ...run.options, align, breakLine: run.text === '\n' || index === runs.length - 1 },
    }));
  });
}

export function imagePath(src:string, roots:MediaRoots) {
  const asset = /^\/assets\/([a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp))$/i.exec(src)?.[1];
  if (asset) return join(roots.catalog,asset);
  const generated = src.startsWith('/api/media/') ? src.slice('/api/media/'.length) : '';
  return generatedImageName.test(generated)?join(roots.generated,generated):undefined;
}

async function bitmap(path:string, target:Box, fitted:boolean) {
  const bytes=await readFile(path);
  return sharp(bytes,{limitInputPixels:16000000})
    .rotate()
    .resize({width:Math.round(target.w*120),height:Math.round(target.h*120),fit:fitted?'contain':'cover',background:{r:0,g:0,b:0,alpha:0}})
    .png()
    .toBuffer();
}

function storyboard(slide:Slide) {
  const contentWidth=wide.w-margin*2;
  if (slide.diagram) {
    if (slide.layout==='split') return {
      kind:'diagram',title:{x:margin,y:1.05,w:4.05,h:1.65},body:{x:margin,y:2.87,w:4.05,h:3.50},
      media:{x:5.35,y:.93,w:wide.w-5.35-margin,h:5.90},
    } as const;
    const inset=slide.layout==='centered'?1.35:slide.layout==='stacked'||slide.layout==='cover'?.93:margin;
    const top=slide.layout==='cover'?2.95:slide.layout==='stacked'?2.72:slide.body?2.47:1.54;
    const width=wide.w-inset*2;
    return {
      kind:'diagram',title:{x:inset,y:slide.layout==='cover'?.42:.22,w:width,h:slide.layout==='cover'?1.10:.76},
      body:{x:inset,y:slide.layout==='cover'?1.60:1.06,w:width,h:.84},
      media:{x:inset,y:top,w:width,h:wide.h-top-.48},
    } as const;
  }
  if (slide.additionalImages?.length || slide.layout === 'image-grid' || slide.layout==='image-section' && slide.image) {
    const split = slide.layout === 'split' || Boolean(slide.design?.variant && (slide.design.cards?.length || slide.design.takeaway));
    return {
      kind:'gallery',
      title:{x:margin,y:.40,w:split?5.55:contentWidth,h:1.22},
      body:{x:margin,y:1.77,w:split?5.55:contentWidth,h:split?4.85:1.05},
      media:split ? {x:6.47,y:.54,w:6.22,h:6.27} :
        slide.layout==='image-section' ? {x:0,y:3.02,w:wide.w,h:4.48} : {x:margin,y:3.02,w:contentWidth,h:3.85},
    } as const;
  }
  const rearranged=['stacked','split','centered'].includes(slide.layout);
  if (rearranged) {
    const split=slide.layout==='split';
    const centered=slide.layout==='centered';
    const hasMedia=Boolean(slide.chart || slide.table || slide.image);
    const title={x:margin,y:split?1.02:.39,w:split?5.55:contentWidth,h:1.35};
    const body={x:split&&!hasMedia?6.67:margin,y:split?(hasMedia?2.60:1.02):1.89,
      w:split?5.55:contentWidth,h:hasMedia?(split?3.95:1.08):4.50};
    const media=split?{x:6.47,y:.54,w:6.22,h:6.27}:
      {x:centered?2.15:margin,y:3.14,w:centered?9.03:contentWidth,h:3.68};
    if (slide.chart) return {kind:'chart',title,body,media} as const;
    if (slide.table) return {kind:'table',title,body,media} as const;
    if (slide.image) return {kind:'image',title,body,media} as const;
    return {kind:'text',title,body} as const;
  }
  const hasTable=slide.layout==='native-table'&&Boolean(slide.table);
  const hasChart=slide.layout==='data-chart'&&Boolean(slide.chart);
  if (hasTable||hasChart) {
    return {
      kind:hasTable?'table':'chart',
      title:{x:margin,y:.40,w:contentWidth,h:1.22},
      body:{x:margin,y:1.77,w:contentWidth,h:1.05},
      media:{x:margin,y:3.02,w:contentWidth,h:3.85},
    } as const;
  }
  if (slide.image && slide.layout === 'image-full') {
    const textWidth=slide.table || slide.chart ? 5.75 : 10.2;
    return {
      kind: 'background-image',
      title: { x: margin, y: 1.45, w: textWidth, h: 1.62 },
      body: { x: margin, y: 3.28, w: textWidth, h: 3.62 },
      media: { x: 0, y: 0, ...wide },
    } as const;
  }
  if (slide.image || slide.table || slide.chart) {
    const imageLeft=slide.layout==='image-left';
    const textWidth=6.1;
    const textX=imageLeft?6.62:margin;
    return {
      kind:slide.chart?'chart':slide.table?'table':'image',
      title:{x:textX,y:slide.layout==='cover'?1.44:.67,w:textWidth,h:1.65},
      body:{x:textX,y:slide.layout==='cover'?3.32:2.48,w:textWidth,h:3.78},
      media:{x:imageLeft?margin:7.08,y:.55,w:imageLeft?5.55:5.65,h:6.4},
    } as const;
  }
  return {
    kind:'text',
    title:{x:margin,y:.53,w:contentWidth,h:1.69},
    body:{x:margin,y:2.36,w:contentWidth,h:4.49},
  } as const;
}

function addMainText(
  target:NativeSlide, slide:Slide, title:NativeText, format:ReturnType<typeof storyboard>,
  text:Pick<PptxGenJS.TextPropsOptions,'lang'|'color'>, titleSize:number, accent:string, fontFace:string, headingFont:string,
) {
  const align = slide.layout==='centered' ? 'center' : 'left';
  const design = slide.design;
  const neutral = design && !design.variant;
  let titleBox = format.title;
  const arrangedDesign = design && (neutral || format.kind!=='text');
  const eyebrow = arrangedDesign && design.eyebrow;
  const eyebrowHeight = eyebrow ? Math.min(.28, titleBox.h * .25) : 0;
  if (eyebrow) titleBox = {...titleBox, y:titleBox.y+eyebrowHeight, h:titleBox.h-eyebrowHeight};
  target.addText(title,{...titleBox,...text,align,...((format.kind==='diagram' || neutral) && {fit:'shrink'}),placeholder:'lesson-title',fontFace:headingFont,fontSize:titleSize,bold:true,margin:0,valign:'middle',objectName:'Slide title'});
  if (eyebrow) target.addText(eyebrow, {...format.title, ...text, align, fontFace, fontSize:12, bold:true, h:eyebrowHeight,
    margin:0, valign:'middle', fit:'shrink', objectName:'Slide eyebrow'});
  if (arrangedDesign && (design.cards?.length || design.takeaway)) {
    const original = nativeBody(slide);
    const runs: PptxGenJS.TextProps[] = typeof original === 'string' ? (original ? [{text:original}] : []) : [...original];
    for (const [index, card] of (design.cards ?? []).entries()) {
      const numbered=design.numbered ?? (design.variant==='activity' || design.variant==='recap');
      runs.push({text:(runs.length ? '\n' : '')+(numbered ? (index+1)+'. ' : '')+card.title, options:{bold:true}},
        {text:'\n'+card.text});
    }
    if (design.takeaway) runs.push({text:(runs.length ? '\n' : '')+design.takeaway, options:{italic:true}});
    target.addText(runs, {...format.body, ...text, align, fontFace, fontSize:24, margin:0, valign:'top', fit:'shrink', objectName:'Slide content'});
    return;
  }
  const hasBody=Boolean(slide.body.trim());
  const cards=slide.design?.cards??[];
  const takeaway=slide.design?.takeaway;
  const useSupplement=(format.kind==='text'||format.kind==='gallery')&&Boolean(cards.length||takeaway);
  if (hasBody) target.addText(nativeBody(slide),{
    ...format.body,...text,align,fontFace,fontSize:24,margin:0,breakLine:false,valign:'top',
    h:useSupplement?Math.min(format.body.h,2):format.body.h, ...(format.kind==='diagram' && {fit:'shrink'}),
    objectName:'Slide content',
  });
  if (useSupplement) {
    const details=[...cards.map(card=>card.title+'\n'+card.text),takeaway].filter(Boolean).join('\n\n');
    if (details) target.addText(details,{
      x:format.body.x,y:hasBody?4.45:format.body.y,w:format.body.w,h:hasBody?2.39:format.body.h,
      ...text,align,fontFace,fontSize:24,color:accent,margin:0,valign:'top',objectName:'Activities and takeaway',
    });
  }
}

function drawingStyle(deck:Deck,layoutId?:string|null) {
  const selected=powerPointVisualStyle(deck.powerPointStyle,layoutId);
  const palette=lessonPalette(deck,layoutId);
  const fontFace=templateFont(selected?.bodyFont ?? deck.brand?.font ?? 'Arial','office');
  const headingFont=templateFont(selected?.headingFont ?? fontFace,'office');
  const ink=color(palette.ink);
  return {
    fontFace,headingFont,ink,paper:color(palette.paper),accent:color(palette.accent),tint:color(palette.tint),
    text:{lang:officeLocale[deck.language],color:ink},
  };
}
type DrawingStyle=ReturnType<typeof drawingStyle>;

export async function makePowerPoint(deck:Deck, roots:MediaRoots) {
  const pptx=new PptxGenJS();
  pptx.layout='LAYOUT_WIDE';
  pptx.title=deck.title;
  pptx.subject=deck.topic;
  pptx.author='Sabaq Studio';
  const base=drawingStyle(deck);
  pptx.theme={headFontFace:base.headingFont,bodyFontFace:base.fontFace};
  const logo=deck.brand?.logo && imagePath(deck.brand.logo,roots);
  const logoBox={x:12.2,y:7.0,w:.92,h:.37};
  const logoData=logo && 'image/png;base64,'+(await bitmap(logo,logoBox,true)).toString('base64');
  const addLogo=(target:NativeSlide)=>{if(logoData)target.addImage({...logoBox,data:logoData,
    objectName:decorativePowerPointName('Organization logo'),altText:''});};
  const imageCache=new Map<string,Promise<Buffer>>();
  const masters=new Set<string>();

  async function addPicture(target:NativeSlide,source:SlideImage,box:Box,name:string,contain=false) {
    const path=imagePath(source.src,roots);
    if (!path) throw new Error('Unsupported local slide image.');
    const fitted=contain || Boolean(source.crop) || isSlideSymbol(source);
    const cacheKey=[path,box.w,box.h,fitted].join(':');
    let image=imageCache.get(cacheKey);
    if (!image) {
      image=bitmap(path,box,fitted);
      imageCache.set(cacheKey,image);
    }
    target.addImage({...box,data:'image/png;base64,'+(await image).toString('base64'),
      altText:source.decorative?'':source.alt,objectName:source.decorative ? decorativePowerPointName(name) : name});
  }

  async function addMedia(target:NativeSlide,slide:Slide,format:{kind:string;media:Box},style:DrawingStyle,prefix='',captionHeight=.43) {
    const {text,fontFace,accent,ink,tint}=style;
    if (format.kind==='diagram' && slide.diagram) {
      const {kind,nodes}=slide.diagram;
      const {boxes,edges}=diagramGeometry(kind,nodes.length);
      const media=format.media;
      target.addText(diagramNames[deck.language][kind],{x:media.x,y:media.y-captionHeight,w:media.w,h:Math.min(.32,captionHeight),
        ...text,fontFace,fontSize:18,bold:true,margin:0,objectName:prefix+'Diagram type'});
      for (const line of edges) {
        target.addShape(pptx.ShapeType.line,{
          x:media.x+Math.min(line.x1,line.x2)*media.w/100, y:media.y+Math.min(line.y1,line.y2)*media.h/100,
          w:Math.abs(line.x2-line.x1)*media.w/100, h:Math.abs(line.y2-line.y1)*media.h/100,
          flipH:line.x2<line.x1,flipV:line.y2<line.y1,
          line:{color:accent,width:1.7,...(kind==='process' && {endArrowType:'triangle' as const})},
          objectName:decorativePowerPointName(prefix+'Diagram connection'),
        });
      }
      for (const [i,b] of boxes.entries()) {
        target.addText(nodes[i],{
          x:media.x+b.x*media.w/100,y:media.y+b.y*media.h/100,w:b.w*media.w/100,h:b.h*media.h/100,
          shape:pptx.ShapeType.roundRect,...text,fontFace,fontSize:20,bold:kind==='mind-map' && i===0,
          fill:{color:tint},line:{color:accent,width:kind==='mind-map' && i===0 ? 2.5 : 1.1},
          margin:.06,align:'center',valign:'middle',wrap:true,fit:'shrink',objectName:prefix+'Diagram node '+(i+1),
        });
      }
    } else if (format.kind==='table' && slide.table) {
      const table=slide.table;
      const header=table.headers.map(value=>({text:value,options:{bold:true,fill:{color:tint}}}));
      target.addTable([header,...table.rows.map(row=>row.map(value=>({text:String(value)})))],{
        ...format.media, ...text, fontFace, fontSize:18, margin:9, autoPage:false,
        border:{color:accent,pt:.5}, rowH:Math.min(.54,format.media.h/(table.rows.length+1)), objectName:prefix+'Editable table',
      });
    } else if (format.kind==='chart' && slide.chart) {
      const chart=slide.chart;
      target.addChart(pptx.ChartType.bar,chart.series.map(series=>({
        name:series.name,labels:chart.categories,values:series.values,
      })),{
        ...format.media,objectName:prefix+'Editable chart',barDir:'col',barGrouping:'clustered',showTitle:false,
        showLegend:chart.series.length>1,chartColors:[accent,ink,tint],
        catAxisLabelColor:ink,valAxisLabelColor:ink,catAxisLabelFontFace:fontFace,valAxisLabelFontFace:fontFace,
        showValue:true,dataLabelColor:ink,dataLabelFormatCode:'0.##',dataLabelPosition:'outEnd',altText:chart.alt,
      });
    } else if (format.kind==='image' || format.kind==='gallery') {
      const images=slideImages(slide);
      const gap=Math.min(.16,format.media.w/12);
      const w=(format.media.w-gap*(images.length-1))/images.length;
      for (const [index,source] of images.entries()) {
        await addPicture(target,source,{...format.media,w,x:format.media.x+index*(w+gap)},
          prefix+'Slide illustration'+(images.length>1?' '+(index+1):''));
      }
    }

  }
  async function addAdaptiveMedia(target:NativeSlide,slide:Slide,area:Box,style:DrawingStyle,background=false) {
    const kinds:string[]=[];
    if (!background && slideImages(slide).length) kinds.push('image');
    if (slide.chart) kinds.push('chart');
    if (slide.table) kinds.push('table');
    if (slide.diagram) kinds.push('diagram');
    const across=area.w>area.h*1.35;
    const gap=.18;
    for (const [index,kind] of kinds.entries()) {
      const length=((across?area.w:area.h)-gap*(kinds.length-1))/kinds.length;
      const media=across ? {...area,x:area.x+index*(length+gap),w:length} : {...area,y:area.y+index*(length+gap),h:length};
      await addMedia(target,slide,{kind,media},style);
    }
  }
  async function addImportedArtwork(target:NativeSlide,slide:Slide) {
    if(!slide.importedArtwork) return;
    const path=imagePath(slide.importedArtwork,roots);
    if(!path) throw new Error('Unsupported imported artwork.');
    target.addImage({...wide,x:0,y:0,data:'image/png;base64,'+(await readFile(path)).toString('base64'),
      altText:'',objectName:decorativePowerPointName('Imported slide artwork')});
  }
  function addCoverOrnaments(target: NativeSlide, slide: Slide) {
    // PptxGenJS supports custom geometry at runtime. Its public shape enum omits it.
    const nativePath = 'custGeom' as PptxGenJS.ShapeType;
    const presetShapes = {rect:pptx.ShapeType.rect, roundRect:pptx.ShapeType.roundRect, ellipse:pptx.ShapeType.ellipse};
    type Points = NonNullable<PptxGenJS.ShapeProps['points']>;
    const invisible = {color:'FFFFFF',transparency:100};
    for (const [index, object] of presentationCoverArtwork(deck, slide).entries()) {
      const {x,y,w,h,rotation,motif,paint,backdrop} = object;
      const ink = color(object.color);
      const box = {x:x*wide.w/100, y:y*wide.h/100, w:w*wide.w/100, h:h*wide.h/100, rotate:(rotation+360)%360};
      const name = decorativePowerPointName('Cover ornament '+(index+1));
      const options = {...box,objectName:name};
      if (motif === 'rect' || motif === 'roundRect' || motif === 'ellipse') {
        target.addShape(presetShapes[motif], {
          ...options, fill:paint === 'fill' ? {color:ink} : invisible,
          line:paint === 'stroke' ? {color:ink,width:1.4} : invisible,
        });
      } else if (motif === 'arch') {
        const arch = Math.min(box.w/2,box.h);
        const points: Points = [{x:0,y:box.h},{x:0,y:arch},
          {x:box.w/2,y:0,curve:{type:'quadratic',x1:0,y1:0}},
          {x:box.w,y:arch,curve:{type:'quadratic',x1:box.w,y1:0}},
          {x:box.w,y:box.h},{close:true}];
        target.addShape(nativePath,{...options,points,fill:invisible,line:{color:ink,width:2}});
      } else if (motif === 'grid') {
        const gap = .033 * wide.w;
        const points: Points = [];
        for (let col = 0; col < box.w; col += gap) points.push({x:col,y:0,moveTo:true},{x:col,y:box.h});
        for (let row = 0; row < box.h; row += gap) points.push({x:0,y:row,moveTo:true},{x:box.w,y:row});
        target.addShape(nativePath,{...options,points,fill:invisible,line:{color:ink,width:1}});
      } else {
        const lower = motif === 'rings-bottom';
        const edge = lower ? box.h : 0;
        const vertical = lower ? -1 : 1;
        function quarter(scale: number): Points {
          const k = .5523;
          const rx = box.w * scale;
          const ry = box.h * scale * vertical;
          return [{x:box.w-rx,y:edge,moveTo:true},{x:box.w,y:edge+ry,
            curve:{type:'cubic',x1:box.w-rx,y1:edge+k*ry,x2:box.w-k*rx,y2:edge+ry}}];
        }
        if (backdrop || lower) target.addShape(nativePath,{
          ...options,objectName:decorativePowerPointName('Cover ornament backing '+(index+1)),
          points:[...quarter(lower ? Math.min(1,.0625*wide.w/box.w) : 1),{x:box.w,y:edge},{close:true}],
          fill:{color:lower ? ink : color(backdrop!)},line:invisible,
        });
        const count = Math.max(1,Math.round(box.w/(wide.w*.025)));
        const first = lower ? Math.min(count,Math.floor(.0625*wide.w/box.w*count)+1) : 1;
        const points = Array.from({length:count-first+1},(_,step) => quarter((first+step)/count)).flat();
        target.addShape(nativePath,{...options,points,fill:invisible,line:{color:ink,width:.6,transparency:lower ? 44 : 55}});
      }
    }
  }
  const offSlideTitle = { x:-3, y:0, w:2, h:1 };
  const nativeFreeTitle = (slide:Slide, layout:ReturnType<typeof effectiveFreeLayout>) =>
    !!slide.title.trim() && canReadVisibleTitleFirst(layout);
  function addTitleOffSlide(target:NativeSlide, slide:Slide, index:number,style:DrawingStyle) {
    target.addText(slide.title.trim() || slideLabel[deck.language]+' '+(index+1),{
      ...offSlideTitle,...style.text,placeholder:'lesson-title',fontFace:style.headingFont,fontSize:32,bold:true,
    });
  }
  function freeSlideMaster(visibleTitle:boolean,style:DrawingStyle,layoutId?:string|null) {
    const masterName=(visibleTitle ? 'Free layout' : 'Title outside slide')+(layoutId ? ' · '+layoutId : '');
    if(!masters.has(masterName)) {
      pptx.defineSlideMaster({title:masterName,background:{color:style.paper},objects:[{placeholder:{options:{
        type:'title',name:'lesson-title',...(visibleTitle ? {x:margin,y:.4,w:12,h:1} : offSlideTitle),
        fontFace:style.headingFont,fontSize:32,
      }}}]});
      masters.add(masterName);
    }
    return masterName;
  }
  async function addFreeSlide(slide:Slide,title:NativeText,index:number,style:DrawingStyle) {
    const {text,paper,fontFace,headingFont,tint,accent}=style;
    const layout=effectiveFreeLayout(slide);
    const photoBackground=hasFreePhotoBackground(slide,layout);
    const visibleTitle=nativeFreeTitle(slide,layout);
    const masterName=freeSlideMaster(visibleTitle,style,slide.powerPointLayoutId);
    const target=pptx.addSlide({masterName});
    target.background={color:paper};
    if (!visibleTitle) addTitleOffSlide(target,slide,index,style);
    await addImportedArtwork(target,slide);
    addCoverOrnaments(target,slide);
    for(const item of layout.items) {
      const box={x:item.x*wide.w/100,y:item.y*wide.h/100,w:item.w*wide.w/100,h:item.h*wide.h/100};
      const prefix='Free/'+item.id+'/';
      if (item.id==='image' || item.id==='image-2' || item.id==='image-3') {
        const image = slideImages(slide)[freeImageIds.indexOf(item.id)];
        if (image) await addPicture(target, image, box, prefix+'Slide illustration', slide.importedPage);
        if(item.id==='image' && photoBackground) target.addShape(pptx.ShapeType.rect,{
          ...box,line:{transparency:100},fill:{color:'101C22',transparency:28},
          objectName:decorativePowerPointName(prefix+'Image contrast overlay'),
        });
        continue;
      }
      if (item.id==='table' || item.id==='chart' || item.id==='diagram') {
        const cap=item.id==='diagram' ? Math.min(.43,box.h*.16) : 0;
        await addMedia(target,slide,{kind:item.id,media:{...box,y:box.y+cap,h:box.h-cap}},style,prefix,cap);
        continue;
      }
      const options={...box,...text,...(photoBackground && {color:'FFFFFF'}),fontFace,margin:0,fit:'shrink' as const,valign:'top' as const,objectName:prefix+item.id};
      if(item.id==='body') target.addText(nativeBody(slide),{...options,fontSize:24});
      else if(item.id==='title' && slide.title.trim())
        target.addText(title,{...options,...(visibleTitle && {placeholder:'lesson-title'}),fontFace:headingFont,fontSize:32,bold:true});
      else if(item.id==='eyebrow') target.addText(slide.design?.eyebrow || lessonPartLabel(slide.lessonPart,deck.language),{...options,color:photoBackground?'DAECC3':accent,fontSize:18});
      else if(item.id==='takeaway') target.addText(slide.design?.takeaway ?? '',{...options,fontSize:24});
      // The presentation initially hides answers. Keep them in the speaker notes in downloaded files.
      else if(item.id!=='answer') {
        const cardIndex=Number(item.id.slice(-1));
        const card=slide.design?.cards?.[cardIndex];
        if(card) target.addText([{text:((slide.design?.numbered ?? (slide.design?.variant==='activity'||slide.design?.variant==='recap')) ? (cardIndex+1)+'. ' : '')+card.title,options:{bold:true,breakLine:true}},{text:card.text}],{...options,color:style.ink,fill:{color:tint},fontSize:22});
      }
    }
    addSlideObjects(target, slide, fontFace);
    const notes=[slide.notes,slide.answer && answerLabel[deck.language]+': '+slide.answer].filter(Boolean).join('\n\n');
    if(notes) target.addNotes(notes);
    addLogo(target);
  }
  function addSlideObjects(target: NativeSlide, slide: Slide, fontFace: string) {
    const shapes = { rectangle: pptx.ShapeType.rect, ellipse: pptx.ShapeType.ellipse, arrow: pptx.ShapeType.rightArrow };
    for (const object of slide.objects ?? []) {
      const box = { x: object.x * wide.w / 100, y: object.y * wide.h / 100,
        w: object.w * wide.w / 100, h: object.h * wide.h / 100, rotate: (object.rotation + 360) % 360 };
      if (object.kind === 'text') {
        target.addText(object.text, { ...box, align: object.align, valign: 'top', bold: object.bold, fontFace,
          fontSize: object.fontSize, color: color(object.color), margin: 0, objectName: 'Text box' });
      } else {
        target.addShape(shapes[object.kind], { ...box, fill: { color: color(object.color) }, line: { transparency: 100 },
          objectName: decorativePowerPointName(object.kind) });
      }
    }
  }
  for (const [index, originalSlide] of deck.slides.entries()) {
    const slide=displaySlide(originalSlide, deck.language);
    const title=nativeTitle(originalSlide,slide);
    const style=slide.powerPointLayoutId ? drawingStyle(deck,slide.powerPointLayoutId) : base;
    const {text,paper,fontFace,headingFont,accent}=style;
    if(slide.freeLayout) {await addFreeSlide(slide,title,index,style);continue;}
    if (slide.importedPage && slide.layout === 'image-full' && slide.image) {
      const path = imagePath(slide.image.src, roots);
      if (!path) throw new Error('Unsupported imported slide image');
      const target = pptx.addSlide({masterName:freeSlideMaster(false,style,slide.powerPointLayoutId)});
      addTitleOffSlide(target,slide,index,style);
      target.addImage({ ...wide, x: 0, y: 0, data: 'image/png;base64,' + (await readFile(path)).toString('base64'),
        altText: slide.image.decorative ? '' : slide.image.alt,
        objectName: slide.image.decorative ? decorativePowerPointName('Imported page') : 'Imported page' });
      addSlideObjects(target, slide, fontFace);
      if (slide.notes) target.addNotes(slide.notes);
      addLogo(target);
      continue;
    }
    const format=storyboard(slide);
    const titleSize=slide.layout==='cover'?36:32;
    const masterName=[slide.powerPointLayoutId,slide.layout,format.kind,format.title.x].filter(Boolean).join('-');
    if (!masters.has(masterName)) {
      pptx.defineSlideMaster({
        title:masterName,
        background:{color:paper},
        objects:[{placeholder:{options:{
          type:'title',name:'lesson-title',...format.title,...text,fontFace:headingFont,bold:true,fontSize:titleSize,
          align:slide.layout==='centered'?'center':'left',
        }}}],
      });
      masters.add(masterName);
    }

    const target=pptx.addSlide({masterName});
    target.background={color:paper};
    await addImportedArtwork(target,slide);
    addCoverOrnaments(target,slide);
    if (format.kind === 'background-image') {
      await addMedia(target, slide, { kind: 'image', media: format.media },style);
      target.addShape(pptx.ShapeType.rect, {
        ...format.media, line: { transparency: 100 }, fill: { color: '101C22', transparency: 28 },
        objectName: decorativePowerPointName('Image contrast overlay'),
      });
      addMainText(target, slide, title, format, { ...text, color: 'FFFFFF' }, titleSize, accent, fontFace, headingFont);
      if (slide.chart || slide.table) {
        const media={x:6.78,y:.72,w:5.9,h:6.05};
        target.addShape(pptx.ShapeType.rect,{...media,line:{transparency:100},fill:{color:paper},
          objectName:decorativePowerPointName('Data background')});
        await addAdaptiveMedia(target,slide,{x:media.x+.12,y:media.y+.15,w:media.w-.24,h:media.h-.30},style,true);
      }
    } else {
      addMainText(target,slide,title,format,text,titleSize,accent,fontFace,headingFont);
      if ('media' in format && format.media) await addAdaptiveMedia(target,slide,format.media,style);
    }

    addSlideObjects(target, slide, fontFace);
    const notes=[slide.notes,slide.answer&&answerLabel[deck.language]+': '+slide.answer].filter(Boolean).join('\n\n');
    if (notes) target.addNotes(notes);
    addLogo(target);
  }
  const buffer=await pptx.write({outputType:'nodebuffer',compression:true});
  if (!Buffer.isBuffer(buffer)) throw new Error('PowerPoint encoder did not return a buffer.');
  const needsSlideMetadata=(slide:Slide)=>Boolean(slide.freeLayout || slide.diagram || slide.importedArtwork || logoData || slide.objects?.some(object=>object.kind!=='text') ||
    presentationCoverArtwork(deck, slide).length ||
    slide.layout==='image-full' && slide.image || slideImages(slide).some(image=>image.decorative));
  if (!deck.powerPointStyle && !deck.slides.some(needsSlideMetadata)) return buffer;
  // Update only parts generated by our writer. Keep original drawings and their relationships intact.
  const archive=await JSZip.loadAsync(buffer);
  for (const [index,slide] of deck.slides.entries()) {
    if (!needsSlideMetadata(slide)) continue;
    const path='ppt/slides/slide'+(index+1)+'.xml';
    const file=archive.file(path)!;
    let xml=applyPowerPointDecorations(await file.async('string'));
    const displayed=displaySlide(slide,deck.language);
    const description=displayed.diagram && diagramDescription(displayed.diagram,deck.language);
    if (slide.freeLayout) {
      const layout=effectiveFreeLayout(slide);
      xml=arrangePowerPointShapes(xml,layout,nativeFreeTitle(slide,layout),description);
    } else if (description) {
      const format=storyboard(slide);
      if (format.kind==='diagram') {
        const {x,y,w,h}=format.media;
        xml=describeNativePowerPointDiagram(xml,{x:x/wide.w*100,y:(y-.43)/wide.h*100,w:w/wide.w*100,h:(h+.43)/wide.h*100},description);
      }
    }
    archive.file(path,xml);
  }
  if(deck.powerPointStyle) for (const file of archive.file(/^ppt\/theme\/theme\d+\.xml$/)) {
    let xml=await file.async('string');
    for (const [slot,value] of Object.entries({dk1:base.ink,lt1:base.paper,accent1:base.accent,lt2:base.tint})) {
      xml=xml.replace(new RegExp('<a:'+slot+'>[\\s\\S]*?</a:'+slot+'>'),'<a:'+slot+'><a:srgbClr val="'+value+'"/></a:'+slot+'>');
    }
    archive.file(file.name,xml);
  }
  return archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

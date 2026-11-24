import type {CSSProperties} from 'react';
import {framePercent,videoFrame,type VideoLayoutSettings} from '@sabaq/contracts/video';
import {effectiveFreeLayout,type FreeItem} from '@sabaq/lesson/free-layout';
import {lessonPalette} from '@sabaq/lesson/themes';
import type {Slide} from '@sabaq/lesson/types';
import {SlideCanvas,type SlideCanvasProps} from './Slide';
import './video-canvas.css';

function reflowFree(slide:Slide, ratio:number):Slide {
  const source=effectiveFreeLayout(slide).items.filter(item=>item.id!=='body' || !!slide.body);
  const title=source.find(item=>item.id==='title');
  const others=source.filter(item=>item.id!=='title' && item.id!=='answer')
    .sort((a,b)=>a.y-b.y || a.x-b.x);
  const columns=others.length>4 || (others.length>2 && ratio>1) ? 2 : 1;
  const rows=Math.max(1,Math.ceil(others.length/columns));
  const start=title ? 19 : 3;
  const rowHeight=(97-start)/rows;
  const native:FreeItem[]=title ? [{...title,x:4,y:3,w:92,h:14}] : [];
  others.forEach((item,i)=>{
    const count=Math.min(columns,others.length-Math.floor(i/columns)*columns);
    const width=94/count;
    native.push({...item,x:3+(i%columns)*width,y:start+Math.floor(i/columns)*rowHeight,w:width-2,h:rowHeight-2});
  });
  return {...slide,freeLayout:{items:native}};
}

export function VideoSlide({settings,...props}:SlideCanvasProps & {settings:VideoLayoutSettings}) {
  const frame=videoFrame(settings),{slide,deck}=props;
  const ratio=frame.contentBox.width/frame.contentBox.height;
  // Keep flattened art and geometry-dependent groups registered to their original slide.
  const fixed=!!(slide.importedPage || slide.importedArtwork || slide.objects?.length || slide.freeLayout?.items.some(item=>item.group || item.rotation));
  const portrait=(settings.aspect ?? '16:9')!=='16:9' || ratio<1.4;
  const adapted=!portrait || fixed || slide.diagram && !slide.freeLayout ? slide :
    slide.freeLayout ? reflowFree(slide,ratio) : {...slide,layout:'stacked' as const};
  const sourceAspect=slide.importedPage && Number.isFinite(slide.importedPageAspect) && slide.importedPageAspect!>0 ? slide.importedPageAspect! : 16/9;
  const sourceWidth=Math.min(frame.contentBox.width,frame.contentBox.height*sourceAspect);
  const backdrop=fixed && (slide.importedArtwork || slide.image?.src);
  const palette=lessonPalette(deck,slide.powerPointLayoutId);
  return <div className="ed-video-content" data-fixed={fixed || undefined} data-source-page={!!slide.importedPage || undefined}
    data-reflow-free={!!(portrait && !fixed && slide.freeLayout) || undefined}
    style={{...framePercent(frame.contentBox,frame),'--source-width':sourceWidth/frame.contentBox.width*100+'%',
      '--source-height':sourceWidth/sourceAspect/frame.contentBox.height*100+'%',
      '--raster-width':Math.max(1,16/9/sourceAspect)*100+'%','--raster-height':Math.max(1,sourceAspect/(16/9))*100+'%',
      background:fixed ? 'linear-gradient(150deg,'+palette.paper+','+palette.tint+')' : palette.paper} as CSSProperties}>
    {backdrop && <img className="ed-video-backdrop" src={backdrop} alt="" aria-hidden="true"/>}
    <SlideCanvas {...props} slide={adapted}/>
  </div>;
}

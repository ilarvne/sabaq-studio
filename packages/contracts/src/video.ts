import type { Locale } from '@sabaq/lesson/types';

export const videoSizes={'16:9':{width:1920,height:1080},'9:16':{width:1080,height:1920},'1:1':{width:1080,height:1080}} as const;
export type VideoAspect=keyof typeof videoSizes;
export type AvatarPlacement='corner'|'half'|'clear';
export type VideoLayoutSettings={aspect?:VideoAspect;avatarPlacement?:AvatarPlacement;captions:boolean;position:'left'|'right'|'none'};
export type VideoSettings = VideoLayoutSettings & { revealParagraphs?:boolean; language: Locale };
export type FrameBox={x:number;y:number;width:number;height:number};

export function videoFrame(settings: VideoLayoutSettings) {
  const {width,height}=videoSizes[settings.aspect ?? '16:9'];
  const captionHeight=settings.captions ? Math.floor(height*.1) : 0;
  const labelHeight=Math.floor(height*.08);
  const labelWidth=Math.floor(width*.16);
  const usable=height-captionHeight;
  const stageHeight=usable-labelHeight;
  const labelBox={x:width-labelWidth,y:0,width:labelWidth,height:labelHeight};
  const captionBox=captionHeight ? {x:0,y:usable,width,height:captionHeight} : undefined;
  const contentBox:FrameBox={x:0,y:labelHeight,width,height:stageHeight};
  let avatarBox:FrameBox|undefined;
  let avatarBackground:'transparent'|'studio'|undefined;
  if(settings.position!=='none') {
    const mode=settings.avatarPlacement ?? 'corner';
    const stacked=height>=width;
    const side=Math.floor(Math.min(width,stageHeight)*.26);
    const fraction=mode==='half' ? .5 : 1/3;
    const w=mode==='corner' ? side : stacked ? width : Math.floor(width*fraction);
    const h=mode==='corner' ? side : stacked ? Math.floor(stageHeight*fraction) : stageHeight;
    avatarBox={x:settings.position==='left' ? 0 : width-w,y:usable-h,width:w,height:h};
    if(stacked) contentBox.height-=h;
    else {
      contentBox.width-=w;
      if(settings.position==='left') contentBox.x=w;
    }
    avatarBackground=mode==='clear' ? 'transparent' : 'studio';
  }
  return {width,height,contentBox,labelBox,captionBox,avatarBox,avatarBackground};
}

export function framePercent(box:FrameBox, frame:{width:number;height:number}) {
  return {left:box.x/frame.width*100+'%',top:box.y/frame.height*100+'%',width:box.width/frame.width*100+'%',height:box.height/frame.height*100+'%'};
}
export type VideoJob = {
  key: string; revision: number; settings: VideoSettings;
  status: 'queued' | 'running' | 'verifying' | 'failed' | 'cancelled' | 'ready'; completed: number; total: number;
};
export type AvatarConsent = {configured:boolean;policy?:string;state:'none'|'enrolling'|'active'|'deleting'|'deleted'};
export type VideoState = { biometrics?:AvatarConsent; enabled: boolean; avatar: boolean; narrationOnly?: true; job?: VideoJob };

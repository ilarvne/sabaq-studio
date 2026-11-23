import { useId, type ReactNode } from 'react';
import { diagramDescription, diagramGeometry, diagramNames, mindMapLabels, type SlideDiagram } from '@sabaq/lesson/diagram';
import type { Locale } from '@sabaq/lesson/types';

export function DiagramPage({ diagram, language, title, body, answer, eyebrow }: {
  diagram:SlideDiagram; language:Locale; title:ReactNode; body:ReactNode; answer:ReactNode; eyebrow?:string;
}) {
  return <section className="ed-diagram-page">
    <header className="ed-diagram-header">
      {eyebrow && <div className="ed-slide-kicker">{eyebrow}</div>}
      <div role="heading" aria-level={2} className="ed-slide-title">{title}</div>
      {body && <div className="ed-slide-body">{body}</div>}
    </header>
    <DiagramGraphic diagram={diagram} language={language}/>
    {answer && <div className="ed-slide-answer">{answer}</div>}
  </section>;
}

export function DiagramGraphic({diagram, language}:{diagram:SlideDiagram;language:Locale}) {
  const captionId=useId();
  const marker=useId().replace(/:/g,'');
  const {boxes,edges}=diagramGeometry(diagram.kind,diagram.nodes.length);
  const MapList=diagram.kind==='mind-map' ? 'ul' : 'ol';
  const roles=mindMapLabels[language];
  return <figure className="ed-diagram" data-diagram={diagram.kind} aria-label={diagramDescription(diagram,language)}>
      <figcaption id={captionId}>{diagramNames[language][diagram.kind]}</figcaption>
      <div className="ed-diagram-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs><marker id={marker} markerWidth="4" markerHeight="4" refX="4" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="var(--ed-accent)"/>
          </marker></defs>
          {edges.map(({x1,y1,x2,y2},i)=><line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="var(--ed-accent)" strokeWidth=".55" markerEnd={diagram.kind==='process' ? 'url(#'+marker+')' : undefined}/>)}
        </svg>
        <MapList role="list" aria-labelledby={captionId}>
          {diagram.nodes.map((node,i)=>{
            const {x,y,w,h}=boxes[i];
            return <li key={i} className="ed-diagram-node" data-root={diagram.kind==='mind-map' && i===0 ? true : undefined}
              style={{left:x+'%',top:y+'%',width:w+'%',height:h+'%'}}>
              {diagram.kind==='mind-map' && <span className="ed-diagram-sr">{i===0 ? roles.root : roles.branch}. </span>}
              <span className="ed-diagram-label">{node}</span>
            </li>;
          })}
        </MapList>
      </div>
    </figure>;
}

import type { ImageMode } from '@sabaq/lesson/types';

export function ImageLayoutSample({ mode }: { mode: ImageMode }) {
  const landscape = <g><rect width="38" height="31" fill="#f7d2a2"/><circle cx="28" cy="8" r="3.1" fill="#e78552"/>
    <path d="M0 23Q9 15 16 20T38 17V31H0Z" fill="#82b5a0"/><path d="M0 27Q16 18 38 25V31H0Z" fill="#3a736a"/></g>;
  const type = <g stroke="#858a9a" strokeWidth="1.4" strokeLinecap="round"><path d="M4 7h14M4 11h10"/><path d="M4 17h16M4 20h13M4 23h7" opacity=".52"/></g>;
  return <svg className="home-image-sample" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
    {mode === 'auto' ? <><rect x="3" y="3" width="37" height="26" rx="2.5" fill="#fff" stroke="#d8d9de"/>
      <g transform="translate(4 3) scale(.8)">{type}</g><svg x="19" y="12" width="41" height="24" viewBox="0 0 38 31" preserveAspectRatio="none">{landscape}</svg></> :
      <><rect x="2" y="3" width="59" height="34" rx="3" fill="#fff" stroke="#d8d9de"/>
        {mode === 'none' ? <><g transform="translate(4 5)">{type}</g><g fill="#60a5fa"><path d="M37 31v-7h4v7zM44 31V19h4v12zM51 31V15h4v16z"/></g></> :
          mode === 'illustrated' ? <><g transform="translate(3 5)">{type}</g><svg x="33" y="5" width="26" height="30" viewBox="0 0 38 31" preserveAspectRatio="none">{landscape}</svg></> :
          <><svg x="3" y="4" width="57" height="32" viewBox="0 0 38 31" preserveAspectRatio="none">{landscape}</svg>
            <path d="M8 10h18m-18 4h12" stroke="white" strokeWidth="2" strokeLinecap="round"/></>}
      </>}
  </svg>;
}

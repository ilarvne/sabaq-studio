import { lazy, Suspense } from 'react';
import { IconContext } from '@phosphor-icons/react';

const EditorApp = lazy(() => import('./App').then(({ App }) => ({ default: App })));
const Projection = lazy(() => import('@/features/presentation/Review').then(({ ReviewReceiver }) => ({ default: ReviewReceiver })));
const JoinPoll = lazy(() => import('@/features/presentation/ClassroomPoll'));

export default function StudioClient() {
  const query = new URLSearchParams(window.location.search);
  const Entry = query.has('join') ? JoinPoll : query.has('lessonProjection') ? Projection : EditorApp;
  return <IconContext.Provider value={{ weight: 'regular', size: 20, 'aria-hidden': true }}>
    <Suspense fallback={null}><Entry /></Suspense>
  </IconContext.Provider>;
}

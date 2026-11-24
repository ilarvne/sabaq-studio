import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import type { Locale } from '@sabaq/lesson/types';
import BlurText from '@/components/react-bits/BlurText';
import { useMediaQuery } from '@/components/coss/use-media-query';
import { homeCopy } from './home-copy';

const holdMs = 5000;

export function HomeHeading({ locale }: { locale: Locale }) {
  const { heading, headingAlternates } = homeCopy[locale];
  const phrases = [heading, ...headingAlternates];
  const root = useRef<HTMLHeadingElement>(null);
  const inView = useInView(root);
  const allowMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
  const [turn, setTurn] = useState(0);
  const phrase = phrases[turn % phrases.length];

  useEffect(() => {
    if (!inView || !allowMotion) return;
    const timer = window.setInterval(() => {
      const title = root.current;
      const hovered = window.matchMedia('(hover: hover)').matches && title?.matches(':hover');
      if (document.hidden || hovered || title?.parentElement?.matches(':focus-within')) return;
      setTurn(previous => previous + 1);
    }, holdMs);
    return () => window.clearInterval(timer);
  }, [inView, allowMotion]);

  return (
    <h1 id="creation-heading" ref={root}>
      <span className="sr-only">{heading}</span>
      <span className="home-heading-stack" aria-hidden="true">
        {phrases.map(item => <span key={item} className="home-heading-measure">{item}</span>)}
        {allowMotion ? (
          <AnimatePresence initial={false}>
            <motion.span
              key={turn}
              className="home-heading-phrase"
              exit={{ opacity: 0, filter: 'blur(5px)', y: -5, transition: { duration: 0.24, ease: 'easeIn' } }}
            >
              <BlurText
                as="span"
                aria-hidden="true"
                className="home-heading-words"
                text={phrase}
                initiallyVisible={turn === 0}
                trigger="load"
                animateBy="words"
                direction="bottom"
                delay={45}
                stepDuration={0.16}
                blur={5}
                distance={7}
              />
            </motion.span>
          </AnimatePresence>
        ) : <span className="home-heading-phrase">{heading}</span>}
      </span>
    </h1>
  );
}

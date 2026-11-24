import { ArrowRightIcon } from '@phosphor-icons/react';

export function HomeSectionHeading({ id, title, href, linkLabel }: {
  id: string;
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="creation-section-title">
      <h2 id={id}>{title}</h2>
      <a href={href} className="creation-section-link">
        <span>{linkLabel}</span>
        <ArrowRightIcon aria-hidden="true" />
      </a>
    </div>
  );
}

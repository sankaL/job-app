import { useId, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

interface FeatureCardProps {
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  tags: string[];
  icon: ReactNode;
  href: string;
}

export function FeatureCard({ title, description, imageUrl, category, tags, icon, href }: FeatureCardProps) {
  const clipId = `feature-cutout-${useId().replace(/:/g, "")}`;

  return (
    <article className="feature-editorial-card min-w-0">
      <div className="feature-editorial-media relative aspect-[4/3]">
        <svg aria-hidden="true" className="absolute h-0 w-0" focusable="false">
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d="M .12 0 H .88 Q 1 0 1 .16 V .40 Q 1 .54 .86 .54 C .73 .54 .655 .67 .655 .82 V .84 Q .655 1 .53 1 H .12 Q 0 1 0 .84 V .16 Q 0 0 .12 0 Z" />
            </clipPath>
          </defs>
        </svg>
        <img src={imageUrl} alt="" loading="lazy" decoding="async"
          style={{ clipPath: `url(#${clipId})` }} className="feature-editorial-image absolute inset-0 h-full w-full object-cover" />
        <span className="feature-editorial-category absolute left-1/2 top-6 inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold">
          <span aria-hidden="true">{icon}</span>{category}
        </span>
        <Link to={href} aria-label={`Request access for ${title}`}
          className="feature-editorial-arrow absolute bottom-0 right-0 flex aspect-square w-[28%] items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current">
          <ArrowUpRight aria-hidden="true" size={32} strokeWidth={1.8} />
        </Link>
      </div>
      <h3 className="mt-6 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">{title}</h3>
      <p className="mt-4 text-base leading-7 text-[var(--color-ink-65)]">{description}</p>
      <ul aria-label={`${title} capabilities`} className="mt-5 flex flex-wrap gap-2">
        {tags.map(tag => <li key={tag} className="feature-editorial-tag rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink">{tag}</li>)}
      </ul>
    </article>
  );
}

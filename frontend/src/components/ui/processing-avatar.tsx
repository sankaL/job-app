/** A decorative paper companion. Motion never represents completed work. */
export function ProcessingAvatar({ active, className = "h-14 w-14", paperColor = "var(--color-background-surface)", sparkleColor = "var(--color-icon-orange)" }: { active: boolean; className?: string; paperColor?: string; sparkleColor?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className={`shrink-0 overflow-visible text-inherit ${className}`}>
      <ellipse cx="48" cy="84" rx="22" ry="4" fill="currentColor" opacity="0.06" />
      <g className={active ? "animate-bounce motion-reduce:animate-none" : undefined}>
        <path d="M29 17h27l13 13v42a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7V24a7 7 0 0 1 7-7Z" fill={paperColor} stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M55 17v11a3 3 0 0 0 3 3h11" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M32 35h12M32 41h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.2" />
        <g className={active ? "animate-pulse motion-reduce:animate-none" : undefined}>
          <circle cx="37" cy="54" r="2.5" fill="currentColor" />
          <circle cx="55" cy="54" r="2.5" fill="currentColor" />
        </g>
        <path d="M40 63q6 6 12 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="m17 53 5 4m47 0 9-8m-46 30-3 5m30-5 3 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <path d="m79 23 1.5 4.5L85 29l-4.5 1.5L79 35l-1.5-4.5L73 29l4.5-1.5Z" fill={sparkleColor} className={active ? "animate-pulse motion-reduce:animate-none" : undefined} />
    </svg>
  );
}


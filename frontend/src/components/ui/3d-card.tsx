"use client";

import { forwardRef, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InteractiveTravelCardProps {
  title: string;
  subtitle: string;
  imageUrl: string;
  actionText: string;
  href: string;
  onActionClick: () => void;
  icon?: ReactNode;
  className?: string;
  tone?: "light" | "dark";
}

/** Image card adapted from the supplied travel card for the public feature grid. */
export const InteractiveTravelCard = forwardRef<HTMLDivElement, InteractiveTravelCardProps>(
  ({ title, subtitle, imageUrl, actionText, href, onActionClick, icon, className, tone = "dark" }, ref) => {
    const reducedMotion = useReducedMotion();
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);
    const springX = useSpring(mouseX, { damping: 15, stiffness: 150 });
    const springY = useSpring(mouseY, { damping: 15, stiffness: 150 });
    const rotateX = useTransform(springY, [-0.5, 0.5], ["10.5deg", "-10.5deg"]);
    const rotateY = useTransform(springX, [-0.5, 0.5], ["-10.5deg", "10.5deg"]);

    const resetTilt = () => { mouseX.set(0); mouseY.set(0); };
    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || event.pointerType !== "mouse") return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      mouseX.set(Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5)));
      mouseY.set(Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5)));
    };

    return (
      <div className="feature-3d-perspective min-w-0">
        <motion.div ref={ref} onPointerMove={handlePointerMove} onPointerLeave={resetTilt}
          onPointerCancel={resetTilt} onBlurCapture={resetTilt}
          style={{ rotateX: reducedMotion ? 0 : rotateX, rotateY: reducedMotion ? 0 : rotateY, transformStyle: "preserve-3d" }}
          className={cn("feature-3d-card relative w-full rounded-2xl border border-[var(--color-border)] bg-canvas shadow-panel", tone === "light" && "feature-3d-card-light", className)}>
          <article className="feature-3d-panel absolute inset-4 rounded-xl shadow-lg">
            <img src={imageUrl} alt="" loading="lazy" decoding="async"
              className="absolute inset-0 h-full w-full rounded-xl object-cover" />
            <div aria-hidden="true" className="feature-3d-shade absolute inset-0 rounded-xl" />
            <div className={cn("relative flex h-full flex-col justify-between gap-6 p-5 sm:p-6", tone === "light" ? "text-ink" : "text-white")}>
              <div className="relative">
                <div className="feature-3d-heading min-w-0">
                  <h3 className="flex min-h-10 items-center pr-14 text-2xl font-semibold leading-tight tracking-tight text-inherit">{title}</h3>
                  <p className="mt-3 text-sm leading-6 opacity-90">{subtitle}</p>
                </div>
                <motion.a href={href} aria-label={`Learn more about ${title}`}
                  whileHover={reducedMotion ? undefined : { scale: 1.1, rotate: "2.5deg" }}
                  whileTap={reducedMotion ? undefined : { scale: 0.9 }}
                  className="feature-3d-link absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-colors hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current">
                  {icon ? <span aria-hidden="true">{icon}</span> : <ArrowUpRight aria-hidden="true" size={20} />}
                </motion.a>
              </div>
              <motion.button type="button" onClick={onActionClick}
                whileHover={reducedMotion ? undefined : { scale: 1.03 }}
                whileTap={reducedMotion ? undefined : { scale: 0.95 }}
                className="feature-3d-action w-full rounded-lg bg-white/10 py-3 text-center text-sm font-semibold text-inherit ring-1 ring-inset ring-white/25 backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current">
                {actionText}
              </motion.button>
            </div>
          </article>
        </motion.div>
      </div>
    );
  },
);

InteractiveTravelCard.displayName = "InteractiveTravelCard";

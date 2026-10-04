"use client";

import { useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ProcessingAvatar } from "@/components/ui/processing-avatar";
import { TextRotate } from "@/components/ui/text-rotate";

const WORDS = ["short", "long", "polished", "work"];
const SPRING = { type: "spring", damping: 30, stiffness: 400 } as const;

function Preview() {
  const [wordIndex, setWordIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const finished = reducedMotion || wordIndex === WORDS.length - 1;

  return (
    <LayoutGroup>
      <motion.span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:gap-x-4" layout={!reducedMotion} transition={SPRING}>
        <motion.span className="whitespace-nowrap" layout={!reducedMotion} transition={SPRING}>Make it</motion.span>
        <TextRotate texts={WORDS} loop={false} onNext={setWordIndex}
          mainClassName="justify-center overflow-hidden rounded-lg bg-hero-orange px-3 py-1 text-white sm:px-4 sm:py-2"
          staggerFrom="last" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "-120%" }}
          staggerDuration={0.025} splitLevelClassName="overflow-hidden pb-1"
          transition={SPRING} rotationInterval={2000} />
        {finished && (
          <motion.span aria-hidden="true" initial={reducedMotion ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }} transition={SPRING}>
            <ProcessingAvatar active className="h-[1.1em] w-[1.1em] text-ink"
              paperColor="var(--color-white)" sparkleColor="var(--color-hero-orange)" />
          </motion.span>
        )}
      </motion.span>
    </LayoutGroup>
  );
}

export { Preview };

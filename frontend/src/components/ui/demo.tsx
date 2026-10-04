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
  const isWork = reducedMotion || wordIndex === WORDS.length - 1;

  return (
    <LayoutGroup>
      <motion.span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:gap-x-4" layout={!reducedMotion} transition={SPRING}>
        <motion.span className="whitespace-nowrap" layout={!reducedMotion} transition={SPRING}>Make my resume</motion.span>
        <motion.span className="inline-flex items-center justify-center gap-2 rounded-lg bg-hero-orange px-3 py-1 text-white sm:gap-3 sm:px-4 sm:py-2"
          layout={!reducedMotion} transition={SPRING}>
          <TextRotate texts={WORDS} loop onNext={setWordIndex}
            mainClassName="justify-center overflow-hidden"
            staggerFrom="last" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "-120%" }}
            staggerDuration={0.025} splitLevelClassName="overflow-hidden pb-1"
            transition={SPRING} rotationInterval={isWork ? 5000 : 2000} />
          {isWork && (
            <motion.span aria-hidden="true" initial={reducedMotion ? false : { opacity: 0, y: "-140%" }}
              animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", damping: 20, stiffness: 220, delay: 0.2 }}>
              <ProcessingAvatar active className="h-[0.9em] w-[0.9em] text-ink"
                paperColor="var(--color-white)" sparkleColor="var(--color-white)" />
            </motion.span>
          )}
        </motion.span>
      </motion.span>
    </LayoutGroup>
  );
}

export { Preview };

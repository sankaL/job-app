"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type AnimatePresenceProps, type HTMLMotionProps, type MotionProps, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

interface TextRotateProps extends Omit<HTMLMotionProps<"span">, "children"> {
  texts: string[];
  rotationInterval?: number;
  animatePresenceMode?: AnimatePresenceProps["mode"];
  animatePresenceInitial?: boolean;
  staggerDuration?: number;
  staggerFrom?: "first" | "last" | "center" | number | "random";
  loop?: boolean;
  auto?: boolean;
  splitBy?: "words" | "characters" | "lines" | string;
  onNext?: (index: number) => void;
  mainClassName?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
}

export interface TextRotateRef {
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  reset: () => void;
}

interface WordObject {
  characters: string[];
  needsSpace: boolean;
}

function splitIntoCharacters(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

const DEFAULT_TRANSITION: Transition = { type: "spring", damping: 25, stiffness: 300 };
const DEFAULT_INITIAL: MotionProps["initial"] = { y: "100%", opacity: 0 };
const DEFAULT_ANIMATE: MotionProps["animate"] = { y: 0, opacity: 1 };
const DEFAULT_EXIT: MotionProps["exit"] = { y: "-120%", opacity: 0 };

const TextRotate = forwardRef<TextRotateRef, TextRotateProps>(({
  texts, transition = DEFAULT_TRANSITION, initial = DEFAULT_INITIAL,
  animate = DEFAULT_ANIMATE, exit = DEFAULT_EXIT, animatePresenceMode = "wait",
  animatePresenceInitial = false, rotationInterval = 2000, staggerDuration = 0,
  staggerFrom = "first", loop = true, auto = true, splitBy = "characters",
  onNext, mainClassName, splitLevelClassName, elementLevelClassName, className, ...props
}, ref) => {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const currentIndex = Math.min(currentTextIndex, Math.max(0, texts.length - 1));
  const displayIndex = reducedMotion ? Math.max(0, texts.length - 1) : currentIndex;
  const currentText = texts[displayIndex] ?? "";

  const elements = useMemo<WordObject[]>(() => {
    const parts = currentText.split(splitBy === "characters" || splitBy === "words" ? " " : splitBy === "lines" ? "\n" : splitBy);
    return parts.map((part, index) => ({
      characters: splitBy === "characters" ? splitIntoCharacters(part) : [part],
      needsSpace: splitBy !== "lines" && index !== parts.length - 1,
    }));
  }, [currentText, splitBy]);
  const totalChars = elements.reduce((sum, word) => sum + word.characters.length, 0);

  const getStaggerDelay = useCallback((index: number) => {
    if (staggerFrom === "first") return index * staggerDuration;
    if (staggerFrom === "last") return (totalChars - 1 - index) * staggerDuration;
    if (staggerFrom === "center") return Math.abs(Math.floor(totalChars / 2) - index) * staggerDuration;
    if (staggerFrom === "random") return Math.abs(Math.floor(Math.random() * totalChars) - index) * staggerDuration;
    return Math.abs(staggerFrom - index) * staggerDuration;
  }, [staggerFrom, staggerDuration, totalChars]);

  const handleIndexChange = useCallback((index: number) => {
    if (!texts.length || index === currentIndex) return;
    setCurrentTextIndex(index);
    onNext?.(index);
  }, [currentIndex, onNext, texts.length]);
  const next = useCallback(() => handleIndexChange(currentIndex === texts.length - 1 ? (loop ? 0 : currentIndex) : currentIndex + 1), [currentIndex, texts.length, loop, handleIndexChange]);
  const previous = useCallback(() => handleIndexChange(currentIndex === 0 ? (loop ? texts.length - 1 : 0) : currentIndex - 1), [currentIndex, texts.length, loop, handleIndexChange]);
  const jumpTo = useCallback((index: number) => {
    if (Number.isFinite(index)) handleIndexChange(Math.max(0, Math.min(Math.trunc(index), texts.length - 1)));
  }, [texts.length, handleIndexChange]);
  const reset = useCallback(() => handleIndexChange(0), [handleIndexChange]);
  useImperativeHandle(ref, () => ({ next, previous, jumpTo, reset }), [next, previous, jumpTo, reset]);

  useEffect(() => {
    if (!auto || reducedMotion || !Number.isFinite(rotationInterval) || rotationInterval <= 0 || texts.length < 2 || (!loop && currentIndex === texts.length - 1)) return;
    const intervalId = window.setInterval(next, Math.max(100, rotationInterval));
    return () => window.clearInterval(intervalId);
  }, [next, rotationInterval, auto, reducedMotion, texts.length, loop, currentIndex]);

  if (!texts.length) return null;
  if (reducedMotion) return <span className={cn("inline-flex whitespace-pre-wrap", mainClassName, className)}>{currentText}</span>;

  return (
    <motion.span className={cn("inline-flex flex-wrap whitespace-pre-wrap", mainClassName, className)} {...props} layout transition={transition}>
      <span className="sr-only" aria-live="off">{currentText}</span>
      <AnimatePresence mode={animatePresenceMode} initial={animatePresenceInitial}>
        <motion.span key={`${displayIndex}:${currentText}`} className={cn("inline-flex flex-wrap", splitBy === "lines" && "w-full flex-col")} layout aria-hidden="true">
          {elements.map((word, wordIndex) => {
            const previousCharsCount = elements.slice(0, wordIndex).reduce((sum, part) => sum + part.characters.length, 0);
            return (
              <span key={wordIndex} className={cn("inline-flex", splitLevelClassName)}>
                {word.characters.map((char, charIndex) => (
                  <motion.span key={charIndex} initial={initial} animate={animate} exit={exit}
                    transition={{ ...transition, delay: getStaggerDelay(previousCharsCount + charIndex) }}
                    className={cn("inline-block", elementLevelClassName)}>{char}</motion.span>
                ))}
                {word.needsSpace && <span className="whitespace-pre"> </span>}
              </span>
            );
          })}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
});

TextRotate.displayName = "TextRotate";
export { TextRotate };

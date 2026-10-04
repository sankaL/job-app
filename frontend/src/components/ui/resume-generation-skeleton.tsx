import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/VStack";

/** Animated paper layout only. Progress comes from the active job. */
export function ResumeGenerationSkeleton({ section = false }: { section?: boolean }) {
  return (
    <VStack
      gap={6}
      aria-hidden="true"
      data-testid="resume-generation-skeleton"
      data-scope={section ? "section" : "resume"}
      className="resume-generation-paper w-full max-w-md shrink-0 rounded-lg border bg-surface p-6 sm:p-8 shadow-sm"
    >
      {!section && (
        <VStack gap={3} className="border-b pb-5">
          <Skeleton width="55%" height="var(--spacing-5)" radius={1} />
          <Skeleton width="76%" height="var(--spacing-2)" radius={1} index={1} />
        </VStack>
      )}
      {Array.from({ length: section ? 2 : 3 }, (_, index) => (
        <VStack gap={3} key={index}>
          <Skeleton width={index === 1 ? "48%" : "32%"} height="var(--spacing-3)" radius={1} index={index * 4 + 2} />
          <VStack gap={2}>
            <Skeleton height="var(--spacing-2)" radius={1} index={index * 4 + 3} />
            <Skeleton width="94%" height="var(--spacing-2)" radius={1} index={index * 4 + 4} />
            <Skeleton width={index === 1 ? "83%" : "70%"} height="var(--spacing-2)" radius={1} index={index * 4 + 5} />
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
}

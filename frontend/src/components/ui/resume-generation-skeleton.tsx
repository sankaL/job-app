import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/VStack";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PartialSection } from "@/lib/api";

/** Animated paper layout. Verified sections replace skeleton blocks as generation reports them. */
export function ResumeGenerationSkeleton({ section = false, backdrop = false, sections = [] }: {
  section?: boolean;
  backdrop?: boolean;
  sections?: readonly PartialSection[];
}) {
  const placeholders = Math.max(section ? 2 : backdrop ? 5 : 3, 1) - sections.length;
  return (
    <VStack
      gap={6}
      aria-hidden="true"
      data-testid="resume-generation-skeleton"
      data-scope={section ? "section" : "resume"}
      className={backdrop ? "resume-generation-paper w-full min-h-96 bg-processing-surface p-6 sm:p-8 motion-reduce:animate-none" : "resume-generation-paper w-full max-w-md shrink-0 rounded-lg border bg-surface p-6 sm:p-8 shadow-sm"}
    >
      {!section && (
        <VStack gap={3} className="border-b pb-5">
          <Skeleton width="55%" height="var(--spacing-5)" radius={1} />
          <Skeleton width="76%" height="var(--spacing-2)" radius={1} index={1} />
        </VStack>
      )}
      {sections.map((ready) => (
        <VStack gap={2} key={ready.id} data-testid="ready-section" className="text-sm text-primary">
          <Heading level={3} className="text-sm font-semibold">{ready.heading}</Heading>
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt || "Image"}</span> }}>
            {ready.content_md}
          </ReactMarkdown>
        </VStack>
      ))}
      {Array.from({ length: Math.max(placeholders, sections.length ? 1 : 0) }, (_, index) => (
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

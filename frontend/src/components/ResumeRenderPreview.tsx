import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ResumeRenderModel, ResumeRenderSection } from "@/lib/api";

interface ResumeRenderPreviewProps {
  model: ResumeRenderModel;
  className?: string;
}

const markdownComponents: Components = {
  a: ({ className, ...props }) => (
    <a {...props} className={cn("underline underline-offset-2", className)} />
  ),
  ul: ({ className, ...props }) => (
    <ul {...props} className={cn("list-disc pl-6", className)} />
  ),
  ol: ({ className, ...props }) => (
    <ol {...props} className={cn("list-decimal pl-6", className)} />
  ),
  li: ({ className, ...props }) => (
    <li {...props} className={cn("list-item", className)} />
  ),
};

const inlineMarkdownComponents: Components = {
  ...markdownComponents,
  p: ({ children }) => <>{children}</>,
};

function InlineMarkdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inlineMarkdownComponents}
    >
      {value}
    </ReactMarkdown>
  );
}

function renderStructuredSection(section: ResumeRenderSection) {
  return (
    <section key={section.heading} className="space-y-4">
      <h2
        className="border-b pb-1 text-[0.82rem] font-semibold uppercase tracking-[0.16em]"
        style={{
          borderColor: "var(--color-text-primary)",
          color: "var(--color-text-primary)",
        }}
      >
        {section.heading}
      </h2>
      <div className="space-y-8">
        {section.entries.map((entry, index) => (
          <article key={`${section.heading}-${index}`} className="space-y-1.5">
            <div className="flex items-start justify-between gap-4">
              <div
                className="min-w-0 flex-1 text-[0.84rem] font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                <InlineMarkdown value={entry.row1_left} />
              </div>
              {entry.row1_right ? (
                <div
                  className="shrink-0 text-right text-[0.84rem] italic"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <InlineMarkdown value={entry.row1_right} />
                </div>
              ) : null}
            </div>
            <div className="flex items-start justify-between gap-4">
              <div
                className="min-w-0 flex-1 text-[0.84rem] italic"
                style={{ color: "var(--color-text-primary)" }}
              >
                <InlineMarkdown value={entry.row2_left} />
              </div>
              {entry.row2_right ? (
                <div
                  className="shrink-0 text-right text-[0.84rem] italic"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <InlineMarkdown value={entry.row2_right} />
                </div>
              ) : null}
            </div>
            {entry.bullets.length ? (
              <ul
                className="list-disc space-y-2 pl-6 text-[0.875rem]"
                style={{ color: "var(--color-text-primary)" }}
              >
                {entry.bullets.map((bullet, bulletIndex) => (
                  <li key={`${section.heading}-${index}-${bulletIndex}`}>
                    <InlineMarkdown value={bullet} />
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function renderMarkdownSection(section: ResumeRenderSection) {
  return (
    <section key={section.heading} className="space-y-3">
      <h2
        className="border-b pb-1 text-[0.82rem] font-semibold uppercase tracking-[0.16em]"
        style={{
          borderColor: "var(--color-text-primary)",
          color: "var(--color-text-primary)",
        }}
      >
        {section.heading}
      </h2>
      <div
        className="prose prose-sm max-w-none text-sm"
        style={{ color: "var(--color-text-primary)" }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {section.markdown_body ?? ""}
        </ReactMarkdown>
      </div>
    </section>
  );
}

export function ResumeRenderPreview({
  model,
  className = "",
}: ResumeRenderPreviewProps) {
  return (
    <div className={cn("space-y-5", className)}>
      {model.header?.name ? (
        <header className="space-y-1.5 text-center">
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {model.header.name}
          </h1>
          {model.header.contact_line ? (
            <p
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {model.header.contact_line}
            </p>
          ) : null}
          {model.header.extra_lines.map((line, index) => (
            <p
              key={`${index}-${line}`}
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {line}
            </p>
          ))}
        </header>
      ) : null}
      {model.sections.map((section) =>
        section.kind === "professional_experience" ||
        section.kind === "education"
          ? renderStructuredSection(section)
          : renderMarkdownSection(section),
      )}
    </div>
  );
}

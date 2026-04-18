import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

const previewComponents: Components = {
  ul: ({ className, ...props }) => <ul {...props} className={cn("list-disc pl-6", className)} />,
  ol: ({ className, ...props }) => <ol {...props} className={cn("list-decimal pl-6", className)} />,
  li: ({ className, ...props }) => <li {...props} className={cn("list-item", className)} />,
};

export function MarkdownPreview({ content, className = "" }: MarkdownPreviewProps) {
  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        className?.includes("markdown-editor-input")
          ? undefined
          : "app-input w-full px-4 py-3 text-sm",
        className,
      )}
      {...props}
    />
  );
});

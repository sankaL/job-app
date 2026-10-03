import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

const DefaultIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ color: "var(--color-border-emphasized)" }}
  >
    <rect x="6" y="6" width="36" height="36" rx="8" />
    <path d="M18 24h12M24 18v12" />
  </svg>
);

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="animate-fadeIn flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4">{icon ?? <DefaultIcon />}</div>
      <Heading
        level={3}
        style={{ color: "var(--color-text-primary)" }}
      >
        {title}
      </Heading>
      {description && (
        <Text
          as="p"
          display="block"
          type="body"
          className="mx-auto mt-2 max-w-md"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {description}
        </Text>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

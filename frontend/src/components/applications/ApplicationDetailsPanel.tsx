import { useId, type ReactNode } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ApplicationDetailsPanel({
  collapsed,
  hidden,
  onToggle,
  children,
}: {
  collapsed: boolean;
  hidden: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <aside
      aria-label="Application details"
      hidden={hidden}
      className={`application-support-column min-w-0${collapsed ? " application-support-column--collapsed" : ""}`}
    >
      <HStack gap={2} vAlign="center" hAlign="between" className="application-support-header">
        <Heading level={2} className="application-support-title" hidden={collapsed}>
          Application details
        </Heading>
        <Button
          variant="ghost"
          size="sm"
          contentLayout="block"
          className="application-support-toggle"
          aria-label={collapsed ? "Expand application details" : "Collapse application details"}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={onToggle}
          title={collapsed ? "Expand application details" : "Collapse application details"}
        >
          <VStack gap={4} align="center">
            {collapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}
            {collapsed && <Text type="label" className="application-support-rail-label" aria-hidden="true">Application details</Text>}
          </VStack>
        </Button>
      </HStack>
      <VStack gap={0} id={contentId} hidden={collapsed} className="application-support-content" tabIndex={0} aria-label="Application detail sections">
        {children}
      </VStack>
    </aside>
  );
}

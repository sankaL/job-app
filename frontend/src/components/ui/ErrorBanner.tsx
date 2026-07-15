import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  UserCheck,
  FileText,
  Sparkles,
  Layers,
  Briefcase,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ErrorBannerProps {
  error: string | null | undefined;
  className?: string;
  onClear?: () => void;
}

type ErrorPresentation = {
  matches: string[];
  title: string;
  subtitle: string;
  description: string;
  variant: "danger" | "warning";
  icon: LucideIcon;
  cta?: { text: string; path: string; icon: LucideIcon };
};

const ERROR_PRESENTATIONS: ErrorPresentation[] = [
  {
    matches: ["profile name", "complete your profile"],
    title: "Profile Setup Incomplete",
    subtitle: "Action Required: Complete Profile",
    description:
      "We need your profile details (such as your full name) to populate the contact header and sections of your resume.",
    variant: "warning",
    icon: UserCheck,
    cta: {
      text: "Complete Profile Settings",
      path: "/app/profile",
      icon: UserCheck,
    },
  },
  {
    matches: [
      "base resume must be linked",
      "base resume id is required",
      "select a base resume",
    ],
    title: "Base Resume Required",
    subtitle: "Action Required: Link Base Resume",
    description:
      "You need to link a base resume to this application to start tailoring. This acts as the source material for the AI.",
    variant: "warning",
    icon: FileText,
    cta: { text: "Manage Base Resumes", path: "/app/resumes", icon: FileText },
  },
  {
    matches: [
      "job title and description are required",
      "job title and description are required for regeneration",
      "add a job title before generating",
      "add a job description before generating",
    ],
    title: "Job Information Required",
    subtitle: "Action Required: Update Job Details",
    description:
      "To tailor your resume, the AI needs a target job title and description. Please supply these under the Job Details panel.",
    variant: "warning",
    icon: Briefcase,
  },
  {
    matches: ["quota exceeded", "limit reached", "generation limit"],
    title: "Monthly Generation Limit Reached",
    subtitle: "Quota Exhausted",
    description:
      "You have used all of your generation requests for this billing period. Your quota will reset soon.",
    variant: "danger",
    icon: Sparkles,
    cta: { text: "View Dashboard Quota", path: "/app", icon: Sparkles },
  },
  {
    matches: ["draft content does not match the structured resume layout"],
    title: "Resume Layout Mismatch",
    subtitle: "Format Error",
    description:
      "The edits made to the Markdown broke the expected resume layout format (headings/sections). Please ensure you preserve the standard headings.",
    variant: "danger",
    icon: Layers,
  },
];

function getErrorPresentation(
  error: string,
): Omit<ErrorPresentation, "matches"> {
  const normalized = error.toLowerCase();
  const matched = ERROR_PRESENTATIONS.find((candidate) =>
    candidate.matches.some((text) => normalized.includes(text)),
  );
  if (matched) return matched;
  return {
    title: "Request failed",
    subtitle: "",
    description: error,
    variant: "danger",
    icon: AlertTriangle,
  };
}

export function ErrorBanner({ error, className, onClear }: ErrorBannerProps) {
  const navigate = useNavigate();

  if (!error) return null;

  const errorStr = String(error);
  const {
    title,
    subtitle,
    description,
    variant,
    icon: Icon,
    cta,
  } = getErrorPresentation(errorStr);

  return (
    <Card variant={variant} density="compact" className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              background:
                variant === "danger"
                  ? "var(--color-ember-10)"
                  : "var(--color-amber-10)",
              color:
                variant === "danger"
                  ? "var(--color-ember)"
                  : "var(--color-amber)",
            }}
          >
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                {title}
              </h3>
              {subtitle && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    color:
                      variant === "danger"
                        ? "var(--color-ember)"
                        : "var(--color-amber)",
                  }}
                >
                  · {subtitle}
                </span>
              )}
            </div>
            <p
              className="mt-1 text-sm leading-relaxed"
              style={{ color: "var(--color-ink-65)" }}
            >
              {description}
            </p>
            {description !== errorStr && (
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--color-ink-45)" }}
              >
                Details: {errorStr}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          {cta && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(cta.path)}
              className="flex items-center gap-1 hover:border-gray-300"
            >
              <cta.icon size={13} />
              {cta.text}
              <ArrowRight size={13} />
            </Button>
          )}
          {onClear && (
            <Button size="sm" variant="secondary" onClick={onClear}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

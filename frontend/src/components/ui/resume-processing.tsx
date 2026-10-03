import { Text } from "@astryxdesign/core/Text";
import { Heading } from "@astryxdesign/core/Heading";
import { useEffect, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import "./resume-processing.css";

export type ProcessingStep = { title: string; detail: string };

export function ResumeProcessing({
  title,
  description,
  message,
  steps,
  currentStep = null,
  percent,
  active = true,
  sessionKey = "import",
  actions,
}: {
  title: string;
  description: string;
  message: string;
  steps: ProcessingStep[];
  currentStep?: number | null;
  percent?: number;
  active?: boolean;
  sessionKey?: string;
  actions?: ReactNode;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!active) return;
    const start = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [active, sessionKey]);
  const measuredPercent =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : undefined;
  const elapsedText =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`;

  return (
    <section
      className="resume-processing"
      aria-label={title}
      data-active={active}
    >
      <div className="resume-processing-topline">
        <span>
          <FileText size={16} aria-hidden="true" /> Resume workspace
        </span>
        <span className="resume-processing-time" aria-label="Elapsed time">
          {elapsedText}
        </span>
      </div>
      <div className="resume-processing-heading">
        <Heading level={2}>{title}</Heading>
        <Text as="p" display="block" type="body">
          {description}
        </Text>
      </div>
      <div className="resume-processing-status">
        <Text
          as="p"
          display="block"
          type="body"
          aria-label="Resume processing status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {message}
        </Text>
        <progress
          aria-label="Resume processing progress"
          max={100}
          value={measuredPercent}
        />
        {elapsed >= 20 && active && (
          <Text
            as="p"
            display="block"
            type="body"
            className="resume-processing-wait"
          >
            Still working. Larger resumes and additional fact checks can take
            longer.
          </Text>
        )}
      </div>
      <div className="resume-processing-plan">
        <Heading level={3}>
          {currentStep === null ? "What this includes" : "Processing steps"}
        </Heading>
        <ol>
          {steps.map((step, index) => (
            <li
              key={step.title}
              aria-current={currentStep === index ? "step" : undefined}
              data-current={currentStep === index}
            >
              <span className="resume-processing-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <Heading level={4}>{step.title}</Heading>
                <Text as="p" display="block" type="body">
                  {step.detail}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="resume-processing-footer">
        <Text as="p" display="block" type="body">
          Your source facts stay grounded in your resume. You can review the
          result before using it.
        </Text>
        {actions}
      </div>
    </section>
  );
}

export function ResumeImportProgress({ useAi }: { useAi: boolean }) {
  return (
    <ResumeProcessing
      title="Reading and structuring your resume"
      description="Turning your PDF into the same section workspace you'll use to review and edit your resume."
      message={
        useAi
          ? "Importing your PDF with AI assistance. Your result will open here when it is ready."
          : "Importing your PDF without AI entry extraction. Your result will open here when it is ready."
      }
      steps={[
        {
          title: "Read the PDF",
          detail: "Extract the text and keep an original copy for comparison.",
        },
        {
          title: "Identify sections",
          detail:
            "Separate experience, education, skills and other source sections.",
        },
        {
          title: useAi
            ? "Separate roles and their details"
            : "Parse recognizable role headers",
          detail: useAi
            ? "Use AI to identify each role's employer, location, dates and duties, including promotions at the same company."
            : "Use local role parsing. Unclear job boundaries stay as source text for you to organize.",
        },
        {
          title: "Prepare your review",
          detail:
            "Check extracted facts against the source, copy duty text and keep contact suggestions local.",
        },
      ]}
    />
  );
}

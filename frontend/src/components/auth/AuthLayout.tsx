import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import portraitRiso from "@/assets/remote-work-portrait.png";
import portraitWater from "@/assets/remote-work-portrait-water.png";
import { cn } from "@/lib/utils";

// Set to "riso" to switch back to the risograph artwork
const AUTH_ART_STYLE: "watercolor" | "riso" = "watercolor";
const portrait = AUTH_ART_STYLE === "watercolor" ? portraitWater : portraitRiso;

type AuthNoticeProps = {
  tone?: "error" | "success";
  action?: ReactNode;
  children: ReactNode;
};

// Feedback for the auth forms always renders directly under the page heading.
export function AuthNotice({ tone = "error", action, children }: AuthNoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm",
        tone === "error"
          ? "border-[var(--color-error-muted)] bg-[var(--color-error-muted)] text-[var(--color-error)]"
          : "border-[var(--color-accent-muted)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]",
      )}
    >
      <p className="min-w-0">{children}</p>
      {action}
    </div>
  );
}

type AuthPageShellProps = {
  title: string;
  description?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  width?: "default" | "wide";
  children?: ReactNode;
};

export function AuthPageShell({ title, description, notice, footer, width = "default", children }: AuthPageShellProps) {
  return (
    <div className="public-design">
      <Theme theme={neutralTheme} mode="light">
        <div className="animate-fadeInUp min-h-screen bg-[#f9f8f6] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <aside className="relative z-10 m-3 hidden rounded-[28px] bg-[linear-gradient(180deg,#eef2ef_0%,#e2eae6_100%)] lg:block">
            <Link to="/" aria-label="Applix home" className="absolute left-8 top-8 z-10 inline-flex">
              <img src="/applix-logo.svg" alt="Applix logo" className="h-10 w-10" />
            </Link>
            <img
              src={portrait}
              alt="Illustration of a person working on a laptop in an armchair"
              className="absolute -right-16 bottom-0 h-[84%] max-h-[860px] w-auto max-w-[calc(100%+2rem)] object-contain object-right-bottom xl:-right-24"
            />
          </aside>

          <main className="flex min-h-screen flex-col px-6 py-8 sm:px-10 lg:pl-28 lg:pr-16 xl:pl-36">
            <Link to="/" aria-label="Applix home" className="inline-flex self-start lg:hidden">
              <img src="/applix-logo.svg" alt="" className="h-9 w-9" />
            </Link>
            <div className={cn("m-auto w-full py-10", width === "wide" ? "max-w-xl" : "max-w-sm")}>
              <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-5xl">{title}</h1>
              {description ? (
                <div className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{description}</div>
              ) : null}
              {notice ? <div className="mt-5">{notice}</div> : null}
              <hr className="my-6 border-0 border-t border-[var(--color-border)]" />
              {children}
              {footer ? (
                <p className="mt-8 text-center text-sm text-[var(--color-text-secondary)]">{footer}</p>
              ) : null}
            </div>
          </main>
        </div>
      </Theme>
    </div>
  );
}

export function AuthFooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-[var(--color-text-primary)] underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

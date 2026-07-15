import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import businessmanIllustration from "@/assets/business-man-illustration.png";

type AuthIllustrationProps = {
  mobileHeight?: "compact" | "default";
  accents?: boolean;
};

function AuthIllustration({ mobileHeight = "default", accents = true }: AuthIllustrationProps) {
  return (
    <div
      className={`relative flex ${mobileHeight === "compact" ? "h-[280px]" : "h-[360px]"} w-full max-w-[860px] items-end justify-center overflow-visible sm:h-[430px] lg:h-screen lg:max-w-[980px]`}
    >
      <div
        className="absolute inset-x-2 bottom-0 top-8 rounded-[40px] sm:inset-x-6 lg:bottom-0 lg:left-[18%] lg:right-0 lg:top-0 lg:rounded-[28px_0_0_28px]"
        style={{
          background: "linear-gradient(180deg, rgba(128, 177, 210, 0.48) 0%, rgba(190, 216, 233, 0.62) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 30px 60px rgba(16, 24, 40, 0.08)",
        }}
      />
      {accents ? (
        <>
          <div
            className="absolute right-10 top-12 hidden h-32 w-32 rounded-full blur-3xl lg:block"
            style={{ background: "rgba(24, 74, 69, 0.14)" }}
          />
          <div
            className="absolute bottom-16 left-10 hidden h-24 w-24 rounded-full blur-3xl lg:block"
            style={{ background: "rgba(159, 58, 22, 0.14)" }}
          />
        </>
      ) : null}
      <div className="relative z-10 max-h-[95%] w-full lg:absolute lg:bottom-0 lg:left-[-10%] lg:h-[100%] lg:w-[100%]">
        <img
          src={businessmanIllustration}
          alt="Businessman seated with a laptop, representing the Applix workspace"
          className="h-full w-full object-contain drop-shadow-[0_28px_38px_rgba(16,24,40,0.18)]"
        />
      </div>
      <div
        className="absolute bottom-6 left-[52%] h-10 w-[58%] -translate-x-1/2 rounded-full blur-2xl lg:bottom-2 lg:left-[48%] lg:w-[54%]"
        style={{ background: "rgba(16, 24, 40, 0.18)" }}
      />
    </div>
  );
}

function AuthAnimationStyles() {
  return (
    <style>{`
      @keyframes floatBlob1 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(10px, -15px) scale(1.05); }
        66% { transform: translate(-8px, 10px) scale(0.97); }
      }
      @keyframes floatBlob2 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(-12px, 12px) scale(1.03); }
        66% { transform: translate(8px, -8px) scale(0.98); }
      }
    `}</style>
  );
}

type AuthBrandProps = {
  subtitle: string;
  linkTo?: string;
  uppercaseSubtitle?: boolean;
};

export function AuthBrand({ subtitle, linkTo, uppercaseSubtitle = true }: AuthBrandProps) {
  const content = (
    <>
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden">
        <img src="/applix-logo.svg" alt="Applix logo" className="h-10 w-10 object-contain" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Applix
        </p>
        <p
          className={uppercaseSubtitle ? "text-xs uppercase tracking-[0.18em]" : "text-xs"}
          style={{ color: "var(--color-ink-50)" }}
        >
          {subtitle}
        </p>
      </div>
    </>
  );
  const className = "inline-flex items-center gap-3 rounded-full border border-black/5 bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm";

  return linkTo ? <Link to={linkTo} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

type AuthPageShellProps = {
  children: ReactNode;
  ambient?: boolean;
  illustrationAccents?: boolean;
  illustrationMobileHeight?: "compact" | "default";
};

export function AuthPageShell({
  children,
  ambient = true,
  illustrationAccents = true,
  illustrationMobileHeight = "default",
}: AuthPageShellProps) {
  const background = ambient
    ? `
        radial-gradient(circle at top left, rgba(159, 58, 22, 0.12), transparent 28%),
        radial-gradient(circle at 85% 20%, rgba(24, 74, 69, 0.16), transparent 30%),
        linear-gradient(135deg, rgba(245, 243, 238, 0.98) 0%, rgba(230, 220, 205, 0.94) 100%)
      `
    : "linear-gradient(135deg, rgba(245, 243, 238, 0.98) 0%, rgba(230, 220, 205, 0.94) 100%)";

  return (
    <div className="animate-fadeInUp relative min-h-screen overflow-hidden" style={{ background }}>
      {ambient ? (
        <>
          <div
            className="absolute left-[-6rem] top-10 h-64 w-64 rounded-full blur-3xl"
            style={{
              background: "linear-gradient(135deg, rgba(159, 58, 22, 0.12), rgba(180, 83, 9, 0.08))",
              animation: "floatBlob1 8s ease-in-out infinite",
            }}
          />
          <div
            className="absolute bottom-0 right-[-3rem] h-80 w-80 rounded-full blur-3xl"
            style={{
              background: "linear-gradient(225deg, rgba(24, 74, 69, 0.12), rgba(31, 95, 89, 0.06))",
              animation: "floatBlob2 10s ease-in-out infinite",
            }}
          />
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(16, 24, 40, 0.12), transparent)" }}
          />
        </>
      ) : null}

      <main className="relative grid min-h-screen lg:grid-cols-[minmax(0,1.08fr)_minmax(480px,0.92fr)]">
        <section className="flex min-h-screen items-start justify-center px-6 pb-12 pt-16 sm:px-10 lg:items-center lg:px-16 lg:pb-6 lg:pt-6 xl:px-20">
          <div className="mx-auto w-full max-w-xl">{children}</div>
        </section>
        <section className="hidden items-end justify-center px-6 pb-6 pt-0 sm:px-10 lg:flex lg:min-h-screen lg:justify-end lg:px-0 lg:py-0">
          <AuthIllustration mobileHeight={illustrationMobileHeight} accents={illustrationAccents} />
        </section>
      </main>
      {ambient ? <AuthAnimationStyles /> : null}
    </div>
  );
}

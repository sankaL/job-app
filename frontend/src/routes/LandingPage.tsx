import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ChevronRight, FileText, Lock, Sparkles, Workflow, Link2, Gauge } from "lucide-react";

const featureCards = [
  {
    title: "Instant job capture",
    description:
      "Paste any job link to automatically extract role requirements, responsibilities, and key attributes. Skip the tedious manual copy-paste work.",
    icon: Link2,
    iconColor: "text-spruce bg-[var(--color-spruce-05)] group-hover:bg-amber group-hover:text-white",
    hoverGlow: "from-[var(--color-amber-10)]",
    iconAnimation: "group-hover:rotate-12",
  },
  {
    title: "Grounded AI agent tailoring",
    description:
      "Generate custom drafts that match the job description while staying grounded in your real work history. Refine specific sections using precise instructions.",
    icon: Sparkles,
    iconColor: "text-spruce bg-[var(--color-spruce-05)] group-hover:bg-spruce group-hover:text-white",
    hoverGlow: "from-[var(--color-spruce-10)]",
    iconAnimation: "group-hover:rotate-45 group-hover:scale-110",
  },
  {
    title: "AI resume judge",
    description:
      "Critique and score your resume against target roles. Receive actionable recommendations based on industry best practices to maximize impact.",
    icon: Gauge,
    iconColor: "text-spruce bg-[var(--color-spruce-05)] group-hover:bg-ember group-hover:text-white",
    hoverGlow: "from-[var(--color-ember-10)]",
    iconAnimation: "group-hover:-rotate-12",
  },
  {
    title: "Centralized workspace",
    description:
      "Organize applications and tailored drafts in one private system. Track your pipeline status to reduce job hunt fatigue and land offers sooner.",
    icon: Workflow,
    iconColor: "text-spruce bg-[var(--color-spruce-05)] group-hover:bg-ink group-hover:text-white",
    hoverGlow: "from-[var(--color-ink-10)]",
    iconAnimation: "group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
  },
];

const pricingPlans = [
  {
    name: "Standard",
    price: "$10",
    yearly: "$96/year",
    discount: "20% yearly discount",
    generations: "50 generations per month",
    description: "For focused job seekers who want dependable tailoring and a clean application workflow.",
    features: [
      "Grounded resume generation",
      "Application tracking",
      "Markdown editing",
      "Strong standard model quality",
    ],
  },
  {
    name: "Pro",
    price: "$30",
    yearly: "$288/year",
    discount: "20% yearly discount",
    generations: "200 generations per month",
    description: "For active search cycles that need more iterations and higher-capability model routing.",
    features: [
      "Everything in Standard",
      "More monthly generations",
      "Better model routing",
      "Designed for heavier search volume",
    ],
    highlighted: true,
  },
];

function MarketingButton({
  to,
  children,
  variant = "primary",
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "text";
}) {
  const className =
    variant === "primary"
      ? "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ember px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(159,58,22,0.18)] ring-1 ring-white/40 transition hover:bg-[var(--color-ember-light)]"
      : variant === "secondary"
        ? "inline-flex h-11 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white px-5 text-sm font-semibold text-ink shadow-xs transition hover:border-[var(--color-border-hover)] hover:text-spruce"
        : "inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold text-ink transition hover:text-spruce";

  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

function AppPreview() {
  const applications = [
    {
      role: "Senior Product Designer",
      company: "Northstar Labs",
      status: "Complete",
      meta: "Exported today",
      active: true,
    },
    {
      role: "Frontend Engineer",
      company: "Cedar Systems",
      status: "In Progress",
      meta: "Resume Judge running",
    },
    {
      role: "Growth Analyst",
      company: "Mercury Works",
      status: "Needs Action",
      meta: "Review duplicate",
    },
    {
      role: "Product Manager",
      company: "Atlas Cloud",
      status: "Draft",
      meta: "Job captured",
    },
  ];

  return (
    <div className="relative mx-auto mt-16 h-[230px] max-w-6xl px-4 sm:mt-20 sm:h-[330px] md:h-[440px] lg:h-[520px] xl:h-[620px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 bottom-8 z-10 h-20 rounded-full bg-[rgba(16,24,40,0.10)] blur-3xl"
      />
      <div
        className="absolute left-1/2 top-0 w-[1120px] origin-top -translate-x-1/2 scale-[0.32] sm:scale-[0.48] md:scale-[0.66] lg:scale-[0.84] xl:scale-100"
        style={{
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 68%, rgba(0,0,0,0.92) 76%, rgba(0,0,0,0.55) 88%, rgba(0,0,0,0.12) 96%, transparent 100%)",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 68%, rgba(0,0,0,0.92) 76%, rgba(0,0,0,0.55) 88%, rgba(0,0,0,0.12) 96%, transparent 100%)",
        }}
      >
        <div className="relative overflow-hidden rounded-xl border border-[rgba(16,24,40,0.12)] bg-white shadow-[0_24px_70px_rgba(16,24,40,0.12)] ring-1 ring-white">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[#f6f5f2] px-4 pt-2.5 pb-2">
          <div className="flex items-center gap-1.5">
            <span className="block h-[11px] w-[11px] rounded-full bg-[#ff5f57]" />
            <span className="block h-[11px] w-[11px] rounded-full bg-[#febc2e]" />
            <span className="block h-[11px] w-[11px] rounded-full bg-[#28c840]" />
          </div>
        </div>
        <div className="grid min-h-[620px] grid-cols-[240px_360px_minmax(0,1fr)] overflow-hidden border-t border-[var(--color-border)] bg-[#fbfaf7]">
          <aside className="border-r border-[var(--color-border)] bg-white/82 p-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-xs">
              <div className="flex items-center gap-2">
                <img src="/applix-logo.svg" alt="Applix logo" className="h-7 w-7" />
                <div>
                  <p className="text-sm font-semibold text-ink">Applix</p>
                  <p className="text-xs text-[var(--color-ink-50)]">June sprint</p>
                </div>
              </div>
            </div>
            <nav className="mt-4 space-y-1 text-sm">
              {["Dashboard", "Applications", "Base Resumes", "Activity"].map((item, index) => (
                <div
                  key={item}
                  className={
                    index === 1
                      ? "rounded-lg bg-spruce px-3 py-2 font-semibold text-white"
                      : "rounded-lg px-3 py-2 font-semibold text-[var(--color-ink-65)]"
                  }
                >
                  {item}
                </div>
              ))}
            </nav>
            <div className="mt-5 rounded-lg border border-[var(--color-spruce-10)] bg-[var(--color-spruce-05)] p-3">
              <p className="text-xs font-semibold text-spruce">Quota</p>
              <p className="mt-2 text-2xl font-semibold text-ink">38</p>
              <p className="text-xs text-[var(--color-ink-50)]">generations left</p>
            </div>
          </aside>

          <section className="border-r border-[var(--color-border)] bg-white/72 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-ink">Applications</p>
                <p className="text-xs text-[var(--color-ink-50)]">Mock search data</p>
              </div>
              <span className="rounded-lg border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-65)]">
                4 active
              </span>
            </div>
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink-40)]">
              Search roles
            </div>
            <div className="mt-4 space-y-3">
              {applications.map((application) => (
                <article
                  key={application.role}
                  className={
                    application.active
                      ? "rounded-lg border border-[rgba(24,74,69,0.22)] bg-[var(--color-spruce-05)] p-3 shadow-xs"
                      : "rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-xs"
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{application.role}</h3>
                      <p className="mt-1 text-xs text-[var(--color-ink-50)]">{application.company}</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[var(--color-ink-65)] ring-1 ring-[var(--color-border)]">
                      {application.status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-ink-50)]">{application.meta}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4">
              <div>
                <p className="text-lg font-semibold text-ink">Tailored draft</p>
                <p className="text-xs text-[var(--color-ink-50)]">Senior Product Designer at Northstar Labs</p>
              </div>
              <span className="rounded-full border border-[var(--color-ember-10)] bg-[var(--color-ember-05)] px-3 py-1 text-xs font-semibold text-ember">
                Resume Judge 88
              </span>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <div className="h-3 w-36 rounded-full bg-ink" />
                <div className="mt-3 h-2 w-full rounded-full bg-[var(--color-ink-10)]" />
                <div className="mt-2 h-2 w-11/12 rounded-full bg-[var(--color-ink-10)]" />
              </div>

              <div className="rounded-lg border border-[var(--color-border)] bg-[#fbfaf7] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-spruce">Professional Experience</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex justify-between gap-4 text-sm font-semibold text-ink">
                      <span>Northstar Labs</span>
                      <span>Toronto, ON</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-4 text-xs text-[var(--color-ink-50)]">
                      <span>Product Designer</span>
                      <span>2022 to Present</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="h-2 w-full rounded-full bg-[rgba(24,74,69,0.18)]" />
                      <div className="h-2 w-10/12 rounded-full bg-[rgba(24,74,69,0.14)]" />
                      <div className="h-2 w-11/12 rounded-full bg-[rgba(24,74,69,0.12)]" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Status", "Complete"],
                  ["Exports", "PDF + DOCX"],
                  ["Applied", "User controlled"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[var(--color-border)] bg-white p-3">
                    <p className="text-xs text-[var(--color-ink-50)]">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 24);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen overflow-hidden bg-canvas pt-20 text-ink">
      <header className="fixed inset-x-0 top-0 z-40 px-4 py-3">
        <div
          className={
            isScrolled
              ? "mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-4 rounded-[28px] border border-[var(--color-border)] bg-white/80 px-6 py-4 shadow-[0_18px_50px_rgba(16,24,40,0.14)] backdrop-blur-xl transition-all duration-300 md:grid-cols-[1fr_auto_1fr]"
              : "mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-4 border border-transparent px-1 py-2 transition-all duration-300 md:grid-cols-[1fr_auto_1fr]"
          }
        >
          <Link to="/" className="flex items-center gap-2" aria-label="Applix home">
            <img src="/applix-logo.svg" alt="Applix logo" className="h-8 w-8" />
            <span className="text-lg font-semibold text-ink">Applix</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-[var(--color-ink-50)] md:flex">
            <a href="#features" className="transition hover:text-spruce">
              Features
            </a>
            <a href="#pricing" className="transition hover:text-spruce">
              Pricing
            </a>
          </nav>
          <div className="flex justify-end gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-ink shadow-xs transition hover:border-[var(--color-border-hover)]"
              to="/login"
            >
              Login
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-lg bg-spruce px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-spruce-light)]"
              to="/signup"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative pt-14 md:pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute left-[-18rem] top-4 hidden h-[48rem] w-[48rem] rounded-full opacity-70 blur-3xl lg:block"
            style={{
              background:
                "radial-gradient(circle, rgba(24,74,69,0.10) 0%, rgba(180,83,9,0.05) 34%, rgba(245,243,238,0) 70%)",
            }}
          />
          <div className="mx-auto max-w-6xl px-5 text-center">
            <Link
              to="/signup"
              className="group mx-auto inline-flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-white/82 py-1 pl-4 pr-1 text-sm font-semibold text-ink shadow-md shadow-black/5 backdrop-blur transition hover:border-[var(--color-border-hover)]"
            >
              <span>Private beta now open</span>
              <span className="h-4 w-px bg-[var(--color-border)]" />
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-spruce-05)] text-spruce transition group-hover:bg-spruce group-hover:text-white">
                <ArrowRight size={14} />
              </span>
            </Link>

            <h1 className="mx-auto mt-10 max-w-5xl text-balance text-6xl font-normal leading-[1.02] tracking-normal text-ink md:text-7xl xl:text-[5.25rem]">
              Tailor Your Resume for Your Dream Role in Seconds
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-balance text-lg leading-8 text-[var(--color-ink-65)]">
              Applix instantly aligns your experience with any job posting to generate grounded, interview-ready drafts while keeping your work history private.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <div className="rounded-xl border border-[var(--color-ink-10)] bg-[var(--color-ink-05)] p-1">
                <MarketingButton to="/login">
                  Login
                </MarketingButton>
              </div>
              <MarketingButton to="/signup" variant="text">
                Request Access
              </MarketingButton>
            </div>
          </div>

          <AppPreview />
        </section>

        <section id="features" className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-spruce">Features</p>
            <h2 className="mt-3 text-4xl font-normal leading-tight text-ink sm:text-5xl">
              Designed for serious job seekers
            </h2>
            <p className="mt-4 text-base leading-7 text-[var(--color-ink-65)]">
              Everything you need to capture roles, tailor drafts, evaluate fit, and manage your pipeline in one private space.
            </p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:gap-8">
            {featureCards.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white/82 p-8 shadow-xs backdrop-blur-sm transition-all duration-500 ease-out hover:-translate-y-1.5 hover:border-spruce/20 hover:bg-white hover:shadow-md"
                >
                  <div
                    className={`absolute -right-20 -top-20 -z-10 h-40 w-40 rounded-full bg-gradient-to-br ${feature.hoverGlow} to-transparent opacity-0 blur-2xl transition-all duration-500 group-hover:opacity-100 group-hover:scale-150`}
                  />
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300 ${feature.iconColor}`}>
                    <Icon size={24} className={`transition-transform duration-500 ${feature.iconAnimation}`} />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-ink transition-colors duration-300 group-hover:text-spruce">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-ink-65)]">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="pricing" className="bg-white/45 py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-5">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold text-spruce">Pricing</p>
              <h2 className="mt-3 text-4xl font-normal leading-tight text-ink sm:text-5xl">
                Simple beta pricing
              </h2>
              <p className="mt-4 text-base leading-7 text-[var(--color-ink-65)]">
                Plans are informational for now. There is no checkout yet, so request early access and the admin
                team will follow up by email.
              </p>
            </div>

            <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-2">
              {pricingPlans.map((plan) => (
                <article
                  key={plan.name}
                  className={
                    plan.highlighted
                      ? "relative rounded-lg border-2 border-spruce bg-white p-7 shadow-panel"
                      : "relative rounded-lg border border-[var(--color-border)] bg-white p-7 shadow-md"
                  }
                >
                  {plan.highlighted ? (
                    <span className="absolute right-4 top-4 rounded-full bg-[var(--color-spruce-05)] px-3 py-1 text-xs font-semibold text-spruce">
                      Popular
                    </span>
                  ) : null}
                  <h3 className="text-xl font-semibold text-ink">{plan.name}</h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-[var(--color-ink-65)]">{plan.description}</p>
                  <div className="mt-7 flex items-end gap-3">
                    <span className="text-5xl font-normal text-ink">{plan.price}</span>
                    <span className="pb-1 text-sm text-[var(--color-ink-50)]">/month</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-spruce">{plan.yearly}</span>
                    <span className="rounded-full bg-[var(--color-amber-10)] px-2.5 py-1 text-xs font-semibold text-amber">
                      {plan.discount}
                    </span>
                  </div>
                  <p className="mt-5 rounded-lg bg-[var(--color-ink-05)] px-3 py-2 text-sm font-semibold text-ink">
                    {plan.generations}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2 text-sm leading-6 text-[var(--color-ink-65)]">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-spruce" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-7">
                    <MarketingButton to="/signup" variant={plan.highlighted ? "primary" : "secondary"}>
                      Request {plan.name} Access
                      {plan.highlighted ? <ChevronRight size={16} /> : null}
                    </MarketingButton>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

import * as React from "react";
import { Legend, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    color?: string;
  }
>;

type ChartContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  config: ChartConfig;
  children: React.ReactElement;
};

type ChartPayloadItem = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
};

type ChartTooltipContentProps = {
  active?: boolean;
  payload?: ChartPayloadItem[];
  label?: string | number;
  labelFormatter?: (value: string | number) => React.ReactNode;
  indicator?: "dot" | "line";
};

type ChartLegendContentProps = {
  payload?: ChartPayloadItem[];
};

const ChartConfigContext = React.createContext<ChartConfig | null>(null);

function useChartConfig() {
  const config = React.useContext(ChartConfigContext);

  if (!config) {
    throw new Error("Chart components must be used inside <ChartContainer />.");
  }

  return config;
}

function getPayloadKey(item: ChartPayloadItem) {
  if (typeof item.dataKey === "string") return item.dataKey;
  if (typeof item.name === "string") return item.name;
  return "";
}

export function ChartContainer({ config, className, style, children, ...props }: ChartContainerProps) {
  const chartVars = Object.entries(config).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value.color) {
      acc[`--color-${key}`] = value.color;
    }
    return acc;
  }, {});

  return (
    <ChartConfigContext.Provider value={config}>
      <div
        className={cn("w-full", className)}
        style={{ ...(chartVars as React.CSSProperties), ...style }}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartConfigContext.Provider>
  );
}

export const ChartTooltip = Tooltip;
export const ChartLegend = Legend;

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  indicator = "dot",
}: ChartTooltipContentProps) {
  const config = useChartConfig();

  if (!active || !payload?.length) return null;

  return (
    <div
      className="min-w-[160px] rounded-xl border px-3 py-2.5 shadow-sm"
      style={{ borderColor: "var(--color-border)", background: "rgba(255,255,255,0.96)" }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
        {labelFormatter ? labelFormatter(label ?? "") : label}
      </div>
      <div className="mt-2 space-y-1.5">
        {payload.map((item) => {
          const key = getPayloadKey(item);
          const chartItem = config[key];
          const tone = item.color ?? chartItem?.color ?? "var(--color-ink)";

          return (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cn("inline-block shrink-0 rounded-full", indicator === "line" ? "h-0.5 w-3" : "h-2.5 w-2.5")}
                  style={{ background: tone }}
                />
                <span style={{ color: "var(--color-ink)" }}>{chartItem?.label ?? key}</span>
              </div>
              <span className="font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>
                {item.value ?? 0}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartLegendContent({ payload }: ChartLegendContentProps) {
  const config = useChartConfig();

  if (!payload?.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em]">
      {payload.map((item) => {
        const key = getPayloadKey(item);
        const chartItem = config[key];
        const tone = item.color ?? chartItem?.color ?? "var(--color-ink)";

        return (
          <div key={key} className="flex items-center gap-1.5" style={{ color: "var(--color-ink-40)" }}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: tone }} />
            <span>{chartItem?.label ?? key}</span>
          </div>
        );
      })}
    </div>
  );
}

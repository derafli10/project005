"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  LineChart,
  Line,
  YAxis,
  XAxis,
  Tooltip,
} from "recharts";
import gsap from "gsap";
import { Activity, Flame, ShieldAlert, Sparkles } from "lucide-react";

import { getCookedMeterStateAction } from "@/app/actions/cooked-meter";
import type { CookedMeterState } from "@/lib/services/cooked-meter.service";
import type { CookedTier } from "@/generated/prisma";

export interface CookedMeterLabels {
  title: string;
  currentScore: string;
  sparkline: string;
  updatedNow: string;
  tierMainCharacter: string;
  tierLetHimCook: string;
  tierSlightlyCooked: string;
  tierOvercooked: string;
  locale: "EN" | "ID";
}

interface CookedMeterProps {
  initialState: CookedMeterState;
  labels: CookedMeterLabels;
}

// Map database tiers to their display colors and styles
const TIER_METADATA: Record<
  CookedTier,
  {
    color: string;
    bg: string;
    text: string;
    border: string;
    labelKey: keyof CookedMeterLabels;
  }
> = {
  MAIN_CHARACTER: {
    color: "#10b981", // Pastel Emerald
    bg: "bg-emerald-50 dark:bg-emerald-950/20",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-900/50",
    labelKey: "tierMainCharacter",
  },
  LET_HIM_COOK: {
    color: "#eab308", // Yellow
    bg: "bg-amber-50 dark:bg-amber-950/20",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-900/50",
    labelKey: "tierLetHimCook",
  },
  SLIGHTLY_COOKED: {
    color: "#f97316", // Orange
    bg: "bg-orange-50 dark:bg-orange-950/20",
    text: "text-orange-700 dark:text-orange-400",
    border: "border-orange-200 dark:border-orange-900/50",
    labelKey: "tierSlightlyCooked",
  },
  OVERCOOKED: {
    color: "#ef4444", // Red
    bg: "bg-red-50 dark:bg-red-950/20",
    text: "text-red-700 dark:text-red-400",
    border: "border-red-200 dark:border-red-900/50",
    labelKey: "tierOvercooked",
  },
};

export function CookedMeter({ initialState, labels }: CookedMeterProps): React.ReactNode {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<CookedMeterState>(initialState);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const glitchRef = useRef<HTMLDivElement>(null);

  // Set mounted flag to avoid Next.js hydration mismatch on charts
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch updated stress metrics from the server action
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const res = await getCookedMeterStateAction();
    if (res.success && res.data) {
      setState(res.data);
    }
    setIsRefreshing(false);
  }, []);

  // Real-time synchronization (Requirement 6.10)
  useEffect(() => {
    window.addEventListener("task-updated", handleRefresh);
    return () => {
      window.removeEventListener("task-updated", handleRefresh);
    };
  }, [handleRefresh]);

  const { cumulativeScore, tier, sparklineData } = state;
  const meta = TIER_METADATA[tier] || TIER_METADATA.MAIN_CHARACTER;
  const tierName = labels[meta.labelKey];

  // GSAP Glitch Effect for OVERCOOKED Tier (Requirement 6.6)
  useEffect(() => {
    if (tier !== "OVERCOOKED" || !glitchRef.current) return;

    const element = glitchRef.current;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 1.5 + Math.random() * 2,
      });

      tl.to(element, { skewX: 12, duration: 0.08, ease: "power4.inOut" })
        .to(element, { skewX: -12, duration: 0.05, ease: "power4.inOut" })
        .to(element, { skewX: 0, duration: 0.04 })
        .to(element, { x: -3, opacity: 0.8, duration: 0.05 })
        .to(element, { x: 3, opacity: 0.9, duration: 0.05 })
        .to(element, { x: 0, opacity: 1, duration: 0.04 });
    }, element);

    return () => ctx.revert();
  }, [tier]);

  // Transform sparkline points for Recharts line chart
  const lineChartData = sparklineData.map((d) => {
    const dDate = new Date(d.date);
    const dayLabel = dDate.toLocaleDateString(labels.locale === "ID" ? "id-ID" : "en-US", {
      weekday: "short",
    });
    return {
      day: dayLabel,
      score: d.score,
      tier: d.tier,
    };
  });

  // Calculate gauge percentage (0-10000 basis points corresponds to 0-100%)
  const percentage = Math.min(100, Math.max(0, (cumulativeScore / 10000) * 100));

  // Gauge data for RadialBarChart
  const radialData = [
    {
      name: "stress",
      value: percentage,
      fill: meta.color,
    },
  ];

  if (!mounted) {
    return (
      <aside className="flex min-h-[16rem] flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex h-full items-center justify-center text-sm text-zinc-400">
          {labels.title}...
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label={labels.title}
      className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-all duration-300 dark:bg-zinc-950 ${meta.border}`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {labels.title}
          </h3>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider shadow-sm transition-colors duration-300 ${meta.bg} ${meta.text}`}
        >
          {tier === "OVERCOOKED" && <Flame className="h-3 w-3 animate-pulse" />}
          {tierName}
        </span>
      </div>

      {/* Main Gauge Visualizer */}
      <div className="relative flex flex-1 flex-col items-center justify-center py-2">
        <div className="relative h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="75%"
              outerRadius="100%"
              barSize={10}
              data={radialData}
              startAngle={180}
              endAngle={0}
            >
              <RadialBar background dataKey="value" cornerRadius={5} />
            </RadialBarChart>
          </ResponsiveContainer>

          {/* Absolute Centered Score Info */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
            <div ref={glitchRef} className="text-center">
              <span className="text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                {cumulativeScore.toLocaleString()}
              </span>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {labels.currentScore}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 7-Day Sparkline Trend (Requirement 6.7) */}
      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-900">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            {labels.sparkline}
          </h4>
          {isRefreshing && (
            <span className="text-[9px] text-zinc-400 animate-pulse">updating...</span>
          )}
        </div>

        {lineChartData.length > 0 ? (
          <div className="h-16 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineChartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="sparklineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="50%" stopColor="#eab308" />
                    <stop offset="80%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
                <YAxis hide domain={["auto", "auto"]} />
                <XAxis hide dataKey="day" />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const dataPoint = payload[0].payload;
                      return (
                        <div className="rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium shadow dark:border-zinc-800 dark:bg-zinc-900">
                          <p className="text-zinc-500">{dataPoint.day}</p>
                          <p className="font-bold text-zinc-900 dark:text-zinc-50">
                            {dataPoint.score} pt
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="url(#sparklineGrad)"
                  strokeWidth={2}
                  dot={{ r: 2, stroke: meta.color, fill: "#fff", strokeWidth: 1 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-16 items-center justify-center text-[10px] text-zinc-400">
            No history data
          </div>
        )}
      </div>
    </aside>
  );
}

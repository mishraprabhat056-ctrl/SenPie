"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartConfig, ChartType } from "@/types/dashboard";

const VIBRANT_PALETTE = [
  "#8b5cf6", // Electric Violet
  "#10b981", // Emerald Green
  "#06b6d4", // Bright Cyan
  "#f59e0b", // Warm Amber
  "#f43f5e", // Coral Rose
  "#6366f1", // Indigo
  "#84cc16", // Lime
  "#ec4899", // Pink
];

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  borderColor: "#3f3f46",
  borderRadius: "10px",
  fontSize: "12px",
  color: "#f4f4f5",
  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
};

// Only show a "$" when the column is clearly money
const MONEY_PATTERN = /price|revenue|cost|amount|sales|income|fee|spend|salary|profit|usd|\$/i;

const trimZero = (text: string) => text.replace(/\.0$/, "");

function formatNumber(
  value: number,
  opts: { money?: boolean; compact?: boolean } = {}
): string {
  if (!Number.isFinite(value)) return "—";
  const prefix = opts.money ? "$" : "";
  const abs = Math.abs(value);
  if (opts.compact) {
    if (abs >= 1e9) return `${prefix}${trimZero((value / 1e9).toFixed(1))}B`;
    if (abs >= 1e6) return `${prefix}${trimZero((value / 1e6).toFixed(1))}M`;
    if (abs >= 1e3) return `${prefix}${trimZero((value / 1e3).toFixed(1))}k`;
    return `${prefix}${Number.isInteger(value) ? value : trimZero(value.toFixed(1))}`;
  }
  return `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// X-axis label that truncates long names (full name shows on hover)
function TruncatedTick({ x, y, payload, rotate }: any) {
  const label = String(payload?.value ?? "");
  const text = label.length > 14 ? `${label.slice(0, 13)}…` : label;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={14}
        textAnchor={rotate ? "end" : "middle"}
        fill="#a1a1aa"
        fontSize={11}
        transform={rotate ? "rotate(-35)" : undefined}
      >
        <title>{label}</title>
        {text}
      </text>
    </g>
  );
}

interface DynamicVisualizerProps {
  config: ChartConfig;
  activeType: ChartType;
}

export function DynamicVisualizer({
  config,
  activeType,
}: DynamicVisualizerProps) {
  const { data, xAxisKey, dataKeys } = config;

  if (!data || data.length === 0 || dataKeys.length === 0) {
    return (
      <div className="flex h-[320px] w-full items-center justify-center text-xs text-zinc-500">
        No data to display.
      </div>
    );
  }

  const isMoney = (dk: { key: string; label: string }) =>
    MONEY_PATTERN.test(`${dk.key} ${dk.label}`);
  const allMoney = dataKeys.every(isMoney);
  const moneyByLabel: Record<string, boolean> = {};
  dataKeys.forEach((dk) => {
    moneyByLabel[dk.label] = isMoney(dk);
  });

  const colorFor = (dk: { color?: string }, idx: number) =>
    dk.color ?? VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length];

  const manyPoints = data.length > 30;
  const rotate =
    data.length > 6 || data.some((row) => String(row[xAxisKey]).length > 10);

  const xAxis = (
    <XAxis
      dataKey={xAxisKey}
      stroke="#a1a1aa"
      tickLine={false}
      interval={data.length <= 20 ? 0 : "preserveStartEnd"}
      minTickGap={data.length <= 20 ? 0 : 24}
      height={rotate ? 64 : 30}
      tick={<TruncatedTick rotate={rotate} />}
    />
  );

  const yAxis = (
    <YAxis
      stroke="#a1a1aa"
      fontSize={12}
      tickLine={false}
      axisLine={false}
      width={56}
      tickFormatter={(v) => formatNumber(Number(v), { money: allMoney, compact: true })}
    />
  );

  const tooltipFormatter = (value: any, name: any) => [
    formatNumber(Number(value), { money: moneyByLabel[String(name)] }),
    name,
  ];

  // A legend adds nothing when there is only one series
  const legend =
    dataKeys.length > 1 ? (
      <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
    ) : null;

  const chartMargin = { top: 20, right: 20, left: 4, bottom: 5 };

  // ---- Heatmap (per-column min/max scaling) ----
  if (activeType === "heatmap") {
    const maxs: Record<string, number> = {};
    dataKeys.forEach((dk) => {
      const colVals = data.map((row) => Number(row[dk.key]) || 0);
      maxs[dk.key] = Math.max(...colVals, 1);
    });

    const getHeatColor = (val: number, maxVal: number) => {
      const ratio = val / maxVal;
      if (ratio > 0.85)
        return "bg-rose-500 text-white border-rose-400 shadow-sm shadow-rose-500/20 font-bold";
      if (ratio > 0.65)
        return "bg-amber-500 text-zinc-950 font-bold border-amber-400";
      if (ratio > 0.4)
        return "bg-emerald-500 text-zinc-950 font-semibold border-emerald-400";
      if (ratio > 0.2) return "bg-cyan-600 text-white border-cyan-400";
      return "bg-indigo-950 text-indigo-200 border-indigo-800";
    };

    return (
      <div className="w-full h-[320px] overflow-x-auto overflow-y-auto py-3 px-2">
        <div className="min-w-[500px]">
          <div
            className="grid gap-2 mb-3"
            style={{
              gridTemplateColumns: `140px repeat(${dataKeys.length}, minmax(100px, 1fr))`,
            }}
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 px-2">
              Segment
            </div>
            {dataKeys.map((dk) => (
              <div
                key={dk.key}
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 text-center"
              >
                {dk.label}
              </div>
            ))}
          </div>

          <div className="space-y-2.5">
            {data.map((row, idx) => (
              <div
                key={idx}
                className="grid gap-2 items-center"
                style={{
                  gridTemplateColumns: `140px repeat(${dataKeys.length}, minmax(100px, 1fr))`,
                }}
              >
                <div
                  className="text-xs font-semibold text-zinc-200 truncate px-2"
                  title={String(row[xAxisKey])}
                >
                  {String(row[xAxisKey])}
                </div>
                {dataKeys.map((dk) => {
                  const val = Number(row[dk.key]) || 0;
                  const maxVal = maxs[dk.key];
                  const pct = Math.round((val / maxVal) * 100);
                  const money = isMoney(dk);
                  return (
                    <div
                      key={dk.key}
                      className={`h-14 rounded-xl border flex flex-col items-center justify-center transition-transform hover:scale-[1.02] cursor-default ${getHeatColor(
                        val,
                        maxVal
                      )}`}
                      title={`${row[xAxisKey]} • ${dk.label}: ${formatNumber(val, { money })}`}
                    >
                      <span className="text-xs font-mono font-bold">
                        {formatNumber(val, { money, compact: true })}
                      </span>
                      <span className="text-[10px] opacity-90 font-medium">
                        {pct}% of peak
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 mt-5 text-[11px] text-zinc-400">
            <span>Low</span>
            <div className="flex gap-1">
              <span className="w-4 h-3 rounded bg-indigo-950 border border-indigo-800" />
              <span className="w-4 h-3 rounded bg-cyan-600" />
              <span className="w-4 h-3 rounded bg-emerald-500" />
              <span className="w-4 h-3 rounded bg-amber-500" />
              <span className="w-4 h-3 rounded bg-rose-500" />
            </div>
            <span>Peak</span>
          </div>
        </div>
      </div>
    );
  }

  // ---- Pie / Donut ----
  if (activeType === "pie") {
    const primary = dataKeys[0];
    const primaryMoney = isMoney(primary);
    return (
      <div className="h-[320px] w-full flex flex-col items-center justify-center pt-6">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              formatter={(value: any, _name: any, item: any) => [
                formatNumber(Number(value), { money: primaryMoney }),
                item?.payload?.[xAxisKey] || primary.label,
              ]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value, entry: any) => {
                const name = entry?.payload?.payload?.[xAxisKey];
                return (
                  <span className="text-zinc-300 font-medium text-xs">
                    {name || value}
                  </span>
                );
              }}
            />
            <Pie
              data={data}
              dataKey={primary.key}
              nameKey={xAxisKey}
              cx="50%"
              cy="48%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={data.length > 1 ? 4 : 0}
              stroke="#09090b"
              strokeWidth={3}
            >
              {data.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={VIBRANT_PALETTE[index % VIBRANT_PALETTE.length]}
                  className="transition-all duration-200 hover:opacity-80 cursor-pointer"
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ---- Line ----
  if (activeType === "line") {
    return (
      <div className="h-[320px] w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            {xAxis}
            {yAxis}
            <Tooltip formatter={tooltipFormatter} contentStyle={TOOLTIP_STYLE} />
            {legend}
            {dataKeys.map((dk, idx) => {
              const color = colorFor(dk, idx);
              return (
                <Line
                  key={dk.key}
                  type="monotone"
                  dataKey={dk.key}
                  name={dk.label}
                  stroke={color}
                  strokeWidth={manyPoints ? 2 : 3}
                  dot={
                    manyPoints
                      ? false
                      : { r: 4, fill: color, strokeWidth: 2, stroke: "#09090b" }
                  }
                  activeDot={{ r: 6 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ---- Area ----
  if (activeType === "area") {
    return (
      <div className="h-[320px] w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            {xAxis}
            {yAxis}
            <Tooltip formatter={tooltipFormatter} contentStyle={TOOLTIP_STYLE} />
            {legend}
            {dataKeys.map((dk, idx) => {
              const color = colorFor(dk, idx);
              return (
                <Area
                  key={dk.key}
                  type="monotone"
                  dataKey={dk.key}
                  name={dk.label}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.25}
                  strokeWidth={2.5}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // ---- Default: Column / Bar ----
  return (
    <div className="h-[320px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          {xAxis}
          {yAxis}
          <Tooltip
            cursor={{ fill: "#27272a", opacity: 0.4 }}
            formatter={tooltipFormatter}
            contentStyle={TOOLTIP_STYLE}
          />
          {legend}
          {dataKeys.map((dk, idx) => (
            <Bar
              key={dk.key}
              dataKey={dk.key}
              name={dk.label}
              fill={colorFor(dk, idx)}
              radius={[6, 6, 0, 0]}
              maxBarSize={56}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
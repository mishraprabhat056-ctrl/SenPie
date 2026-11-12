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
];

interface DynamicVisualizerProps {
  config: ChartConfig;
  activeType: ChartType;
}

export function DynamicVisualizer({
  config,
  activeType,
}: DynamicVisualizerProps) {
  const { data, xAxisKey, dataKeys } = config;

  // Multi-Color Thermal Heatmap Renderer (Per-Column Min/Max Scaling)
  if (activeType === "heatmap") {
    // Calculate max value per dataKey column so each metric scales correctly
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
      if (ratio > 0.2)
        return "bg-cyan-600 text-white border-cyan-400";
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
                <div className="text-xs font-semibold text-zinc-200 truncate px-2">
                  {String(row[xAxisKey])}
                </div>
                {dataKeys.map((dk) => {
                  const val = Number(row[dk.key]) || 0;
                  const maxVal = maxs[dk.key];
                  const pct = Math.round((val / maxVal) * 100);
                  return (
                    <div
                      key={dk.key}
                      className={`h-14 rounded-xl border flex flex-col items-center justify-center transition-transform hover:scale-[1.02] cursor-default ${getHeatColor(
                        val,
                        maxVal
                      )}`}
                      title={`${row[xAxisKey]} • ${dk.label}: ${val.toLocaleString()}`}
                    >
                      <span className="text-xs font-mono font-bold">
                        ${(val / 1000).toFixed(1)}k
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

  // Multi-Color Region Share Pie / Donut Chart (Fixed top clipping)
  if (activeType === "pie") {
    const primaryValueKey = dataKeys[0]?.key || "revenue";
    return (
      <div className="h-[320px] w-full flex flex-col items-center justify-center pt-6">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              formatter={(value: any, name: any, item: any) => [
                `$${Number(value).toLocaleString()}`,
                item?.payload?.[xAxisKey] || "Value",
              ]}
              contentStyle={{
                backgroundColor: "#18181b",
                borderColor: "#3f3f46",
                borderRadius: "10px",
                fontSize: "12px",
                color: "#f4f4f5",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              formatter={(value, entry: any) => {
                const regionName = entry?.payload?.payload?.[xAxisKey];
                return <span className="text-zinc-300 font-medium text-xs">{regionName || value}</span>;
              }}
            />
            <Pie
              data={data}
              dataKey={primaryValueKey}
              nameKey={xAxisKey}
              cx="50%"
              cy="48%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={5}
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

  // Multi-Color Line Chart
  if (activeType === "line") {
    return (
      <div className="h-[320px] w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey={xAxisKey} stroke="#a1a1aa" fontSize={12} tickLine={false} />
            <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                borderColor: "#3f3f46",
                borderRadius: "10px",
                fontSize: "12px",
                color: "#f4f4f5",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            {dataKeys.map((dk, idx) => {
              const strokeColor = VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length];
              return (
                <Line
                  key={dk.key}
                  type="monotone"
                  dataKey={dk.key}
                  name={dk.label}
                  stroke={strokeColor}
                  strokeWidth={3}
                  dot={{ r: 4, fill: strokeColor, strokeWidth: 2, stroke: "#09090b" }}
                  activeDot={{ r: 6 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Multi-Color Area Chart
  if (activeType === "area") {
    return (
      <div className="h-[320px] w-full pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey={xAxisKey} stroke="#a1a1aa" fontSize={12} tickLine={false} />
            <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                borderColor: "#3f3f46",
                borderRadius: "10px",
                fontSize: "12px",
                color: "#f4f4f5",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            {dataKeys.map((dk, idx) => {
              const color = VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length];
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

  // Default: Multi-Color Column / Bar Chart
  return (
    <div className="h-[320px] w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey={xAxisKey} stroke="#a1a1aa" fontSize={12} tickLine={false} />
          <YAxis stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#27272a", opacity: 0.4 }}
            contentStyle={{
              backgroundColor: "#18181b",
              borderColor: "#3f3f46",
              borderRadius: "10px",
              fontSize: "12px",
              color: "#f4f4f5",
            }}
          />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
          {dataKeys.map((dk, idx) => (
            <Bar
              key={dk.key}
              dataKey={dk.key}
              name={dk.label}
              fill={VIBRANT_PALETTE[idx % VIBRANT_PALETTE.length]}
              radius={[6, 6, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
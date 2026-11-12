"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Cpu,
  Database,
  Grid3X3,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Microscope,
  PieChart as PieChartIcon,
  Plus,
  Send,
  Sparkles,
  Table as TableIcon,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DynamicVisualizer } from "@/components/charts/dynamic-visualizer";
import { ChartConfig, ChartType, ChatMessage } from "@/types/dashboard";

const API_URL = "http://localhost:8000";

type Kpi = { label: string; value: string; delta?: string };
type DbInfo = {
  connected: boolean;
  name: string | null;
  table_count: number;
  row_count: number;
};

const formatCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${Math.round(n / 1_000)}k`
    : `${n}`;

const CHART_OPTIONS: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: "bar", label: "Column", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { type: "line", label: "Line", icon: <LineChartIcon className="h-3.5 w-3.5" /> },
  { type: "area", label: "Area", icon: <Activity className="h-3.5 w-3.5" /> },
  { type: "pie", label: "Pie", icon: <PieChartIcon className="h-3.5 w-3.5" /> },
  { type: "heatmap", label: "Heatmap", icon: <Grid3X3 className="h-3.5 w-3.5" /> },
];

type VizMode = "auto" | ChartType;

// Auto mode: pick a sensible chart type from the wording of the question
const pickAutoChartType = (query: string, fallback: ChartType): ChartType => {
  const q = query.toLowerCase();
  if (/(trend|over time|growth|monthly|weekly|daily|timeline)/.test(q)) return "line";
  if (/(cumulative|running total|stacked|accumulat)/.test(q)) return "area";
  if (/(share|proportion|percent|breakdown|split|composition|mix)/.test(q)) return "pie";
  if (/(correlat|heatmap|density|intensity|concentration|pipeline)/.test(q)) return "heatmap";
  if (/(compare|comparison|versus|region|rank|top|perform|target)/.test(q)) return "bar";
  return fallback;
};

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome-1",
  role: "assistant",
  content:
    "Welcome to SenPie, your personal data analyst. Switch chart types above the canvas anytime, or toggle Deep Research mode below for multi-step root-cause analysis.",
  timestamp: "Just now",
};

export default function SenPieDashboard() {
  // ---- State (all hooks live INSIDE the component, before the return) ----
  const [inputQuery, setInputQuery] = useState("");
  const [deepResearch, setDeepResearch] = useState(false);
  const [selectedChartType, setSelectedChartType] = useState<ChartType>("bar");
  const [vizMode, setVizMode] = useState<VizMode>("auto");
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);

  // ---- Load the real database info + headline metrics ----
  useEffect(() => {
    const loadOverview = async () => {
      try {
        const res = await fetch(`${API_URL}/api/db-info`);
        setDbInfo(await res.json());
      } catch {
        setDbInfo({ connected: false, name: null, table_count: 0, row_count: 0 });
      }
      try {
        const res = await fetch(`${API_URL}/api/kpis`);
        const data = await res.json();
        setKpis(data.kpis ?? []);
      } catch {
        setKpis([]);
      } finally {
        setKpisLoading(false);
      }
    };
    loadOverview();
  }, []);

  const shownKpis: Kpi[] = kpis.length
    ? kpis
    : [1, 2, 3].map((n) => ({
        label: kpisLoading ? "Loading metric…" : "No metric yet",
        value: "—",
      }));

  // ---- Send message to the live FastAPI backend ----
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim()) return;

    const userQuery = inputQuery;
    const isDeep = deepResearch;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userQuery,
      timestamp: "Now",
      isDeepResearch: isDeep,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userQuery,
          deep_research: isDeep,
          visualization: vizMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();

      const aiReply: ChatMessage = {
        id: `ai-${Date.now() + 1}`,
        role: "assistant",
        content: data.answer,
        timestamp: "Now",
        isDeepResearch: isDeep,
        researchSteps: data.research_steps,
      };

      setMessages((prev) => [...prev, aiReply]);

      // Replace the canvas data with live rows from the database
      if (data.chart) {
        setChartConfig(data.chart as ChartConfig);
      }

      // Auto mode: use the backend's suggestion if valid, else infer from the question
      if (vizMode === "auto") {
        const fromServer = CHART_OPTIONS.find((o) => o.type === (data.chart?.type ?? data.chart_type))?.type;
        setSelectedChartType(
          fromServer ?? pickAutoChartType(userQuery, selectedChartType)
        );
      }
    } catch (error) {
      console.error("Backend connection error:", error);
      const errorReply: ChatMessage = {
        id: `ai-${Date.now() + 1}`,
        role: "assistant",
        content:
          "⚠️ Error: Could not connect to the SenPie backend server. Make sure FastAPI is running on port 8000.",
        timestamp: "Now",
      };
      setMessages((prev) => [...prev, errorReply]);
    }
  };

  // ---- Render ----
  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      {/* 1. LEFT SIDEBAR */}
      <aside className="hidden md:flex w-64 flex-col border-r border-zinc-800/80 bg-zinc-900/40">
        <div className="flex h-14 items-center gap-2.5 px-4 border-b border-zinc-800/80">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-500/20">
            <Cpu className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-100">
            Sen<span className="text-indigo-400">Pie</span>
          </span>
        </div>

        <div className="flex-1 px-3 py-4 space-y-6">
          <div className="space-y-1">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Workspace
            </p>
            <Button
              variant="secondary"
              className="w-full justify-start gap-2.5 bg-zinc-800/70 text-zinc-100 hover:bg-zinc-800"
            >
              <LayoutDashboard className="h-4 w-4 text-indigo-400" />
              Active Canvas
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40"
            >
              <Database className="h-4 w-4" />
              Data Sources
            </Button>
          </div>

          <Separator className="bg-zinc-800/80" />

          <div className="space-y-2 px-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Connected DB
              </span>
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] px-1.5 py-0"
              >
                {dbInfo ? (dbInfo.connected ? "Ready" : "Offline") : "Checking"}
              </Badge>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 text-xs">
              <p className="font-medium text-zinc-200">
                {dbInfo?.connected ? dbInfo.name : "No database connected"}
              </p>
              <p className="text-zinc-500 mt-0.5 font-mono text-[11px]">
                {dbInfo?.connected
                  ? `${dbInfo.table_count} tables • ${formatCount(dbInfo.row_count)} rows`
                  : "Check DATABASE_URL in backend/.env"}
              </p>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-zinc-800/80">
          <Button
            variant="outline"
            onClick={() => {
              setMessages([WELCOME_MESSAGE]);
              setChartConfig(null);
            }}
            className="w-full justify-start gap-2 border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          >
            <Plus className="h-4 w-4" />
            New Analysis
          </Button>
        </div>
      </aside>

      {/* 2. CENTER PANEL: Visualization Canvas */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 overflow-y-auto">
        <header className="flex h-14 items-center justify-between border-b border-zinc-800/80 px-6">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium text-zinc-100">
              Analytics Overview
            </h1>
            <Badge
              variant="secondary"
              className="bg-zinc-900 text-zinc-400 border border-zinc-800 font-mono text-[11px]"
            >
              {dbInfo?.connected ? "Live" : "Offline"}
            </Badge>
          </div>

          <Tabs defaultValue="charts" className="w-auto">
            <TabsList className="bg-zinc-900 border border-zinc-800 h-8">
              <TabsTrigger value="charts" className="text-xs gap-1.5 h-6">
                <TrendingUp className="h-3.5 w-3.5" />
                Charts
              </TabsTrigger>
              <TabsTrigger value="table" className="text-xs gap-1.5 h-6">
                <TableIcon className="h-3.5 w-3.5" />
                Data Grid
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </header>

        <ScrollArea className="flex-1 p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Top KPI Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {shownKpis.map((kpi, i) => (
                <div
                  key={`${kpi.label}-${i}`}
                  className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-4"
                >
                  <p className="text-xs text-zinc-400">{kpi.label}</p>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-semibold tracking-tight font-mono text-zinc-100">
                      {kpi.value}
                    </span>
                    {kpi.delta && (
                      <span className="text-xs font-medium text-emerald-400">
                        {kpi.delta}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Interactive Chart Card with Visualization Type Selector */}
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/30 p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800/70">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">
                    {chartConfig?.title ?? "Visualization"}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {chartConfig?.description ??
                      "Ask a question in the chat and your chart will appear here."}
                  </p>
                </div>

                {/* Interactive Visualization Selector Pill Bar */}
                <div className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-1 gap-1 self-start">
                  {CHART_OPTIONS.map((option) => {
                    const isActive = selectedChartType === option.type;
                    return (
                      <Tooltip key={option.type}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedChartType(option.type);
                              setVizMode(option.type);
                            }}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                              isActive
                                ? "bg-indigo-600 text-white shadow-sm"
                                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                            }`}
                          >
                            {option.icon}
                            <span className="hidden lg:inline">{option.label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Switch to {option.label} View
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Visualization Output */}
              <div className="pt-6">
                {chartConfig ? (
                  <DynamicVisualizer
                    config={chartConfig}
                    activeType={selectedChartType}
                  />
                ) : (
                  <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 text-center">
                    <Sparkles className="h-5 w-5 text-indigo-400" />
                    <p className="text-xs text-zinc-400">
                      No visualization yet. Ask SenPie Maestro a question about your data.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </main>

      {/* 3. RIGHT PANEL: AI Copilot with Deep Research Toggle */}
      <section className="w-full md:w-96 h-full flex flex-col border-l border-zinc-800/80 bg-zinc-900/30">
        <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span className="text-sm font-medium text-zinc-100">
              Sen<span className="text-indigo-400">Pie</span> Maestro
            </span>
          </div>
          {deepResearch ? (
            <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">
              Deep Research ON
            </Badge>
          ) : (
            <Badge className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px]">
              Standard Mode
            </Badge>
          )}
        </div>

        {/* Message Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-xl border p-3.5 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600/15 border-indigo-500/30 text-zinc-100 ml-6"
                    : "bg-zinc-900/80 border-zinc-800 text-zinc-300"
                }`}
              >
                {msg.isDeepResearch && msg.role === "user" && (
                  <div className="flex items-center gap-1 text-[10px] font-medium text-amber-400 mb-1">
                    <Microscope className="h-3 w-3" />
                    Deep Research Requested
                  </div>
                )}

                {/* Multi-step Deep Research Trace */}
                {msg.researchSteps && msg.researchSteps.length > 0 && (
                  <div className="mb-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-zinc-950/80 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <Microscope className="h-3 w-3" />
                      Multi-Step Research Trace
                    </p>
                    {msg.researchSteps.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-medium text-zinc-200">
                            {s.step}:{" "}
                          </span>
                          <span className="text-zinc-400">{s.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Prompt Input & Deep Research Action Bar */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/70 space-y-2.5">
          {/* Interactive Mode Controls */}
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDeepResearch(!deepResearch)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                    deepResearch
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-300 shadow-sm shadow-amber-500/10"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                  }`}
                >
                  <Microscope className="h-3.5 w-3.5" />
                  Deep Research
                  <span
                    className={`ml-1 h-1.5 w-1.5 rounded-full ${
                      deepResearch ? "bg-amber-400 animate-pulse" : "bg-zinc-600"
                    }`}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">
                Enables multi-step statistical synthesis, anomaly detection, and deep cross-cohort analysis.
              </TooltipContent>
            </Tooltip>

            <select
              value={vizMode}
              onChange={(e) => {
                const mode = e.target.value as VizMode;
                setVizMode(mode);
                if (mode !== "auto") setSelectedChartType(mode);
              }}
              aria-label="Visualization type"
              title="Visualization type"
              className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-zinc-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="auto" className="bg-zinc-900">Auto</option>
              {CHART_OPTIONS.map((option) => (
                <option key={option.type} value={option.type} className="bg-zinc-900">
                  {option.label}
                </option>
              ))}
            </select>

            <span className="text-[11px] text-zinc-500 font-mono">Fast SQL</span>
          </div>

          <form onSubmit={handleSendMessage} className="relative">
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask a question about your data..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 py-2.5 pl-3 pr-10 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
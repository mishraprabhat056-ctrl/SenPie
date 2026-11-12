export type ChartType = "bar" | "line" | "pie" | "area" | "heatmap";

export interface ChartConfig {
  id: string;
  title: string;
  description?: string;
  type: ChartType;
  data: Record<string, string | number>[];
  xAxisKey: string;
  dataKeys: {
    key: string;
    label: string;
    color: string;
  }[];
}

export interface ResearchStep {
  step: string;
  detail: string;
  status: "completed" | "running";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  isDeepResearch?: boolean;
  researchSteps?: ResearchStep[];
  sqlQuery?: string;
  chartConfig?: ChartConfig;
}
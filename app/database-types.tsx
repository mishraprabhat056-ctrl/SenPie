export type ChartType = "bar" | "line" | "pie" | "area" | "heatmap";

export interface ChartConfig {
  id: string;
  title: string;
  description?: string;
  type: ChartType;
  data: Record<string, string | number | null>[];
  xAxisKey: string;
  dataKeys: {
    key: string;
    label: string;
    color: string;
  }[];
}

export interface DatabaseConnection {
  connection_id: string;
  name: string;
  database: string;
  host: string;
  port: number;
  connected: boolean;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface DatabaseTable {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: DatabaseColumn[];
  foreign_keys?: Array<{
    columns: string[];
    referred_schema?: string | null;
    referred_table?: string | null;
    referred_columns: string[];
  }>;
}

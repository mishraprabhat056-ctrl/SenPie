"""SenPie API (Groq edition): question -> LLM-written SQL -> read-only Postgres -> chart JSON."""
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

from database import MAX_ROWS, engine, get_db_stats, get_schema_info, run_readonly_query

load_dotenv()
logger = logging.getLogger("senpie")

MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
CHART_TYPES = ["bar", "line", "area", "pie", "heatmap"]
PALETTE = ["#8b5cf6", "#10b981", "#f59e0b", "#06b6d4", "#f43f5e", "#6366f1"]

app = FastAPI(title="SenPie Open-Source AI Analytics API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY") or "missing",
)


# ---------------------------------------------------------------- models ----
class ChatRequest(BaseModel):
    query: str
    deep_research: bool = False
    chart_type: str = "auto"                # kept for backwards compatibility
    visualization: Optional[str] = None     # sent by the dashboard dropdown


class ResearchStep(BaseModel):
    step: str
    detail: str
    status: str = "completed"


class ChatResponse(BaseModel):
    answer: str
    model_used: str = MODEL
    sql_executed: Optional[str] = None
    data_results: Optional[List[Dict[str, Any]]] = None
    chart_meta: Optional[Dict[str, Any]] = None
    chart: Optional[Dict[str, Any]] = None  # full ChartConfig the dashboard draws
    table: Optional[Dict[str, Any]] = None  # rows for the Data Grid tab
    display: Optional[str] = None           # "chart" | "table" | "none"
    research_steps: Optional[List[ResearchStep]] = None


# ------------------------------------------------------------------- LLM ----
DATA_RULES = """- Write exactly ONE read-only PostgreSQL SELECT (CTEs allowed). No semicolons, no DDL/DML.
- Only use tables and columns that exist in the schema.
- Look at the sample rows: they show the REAL value formats. Columns typed as text can hold
  numbers or currency (for example '$1,250.00'). Convert before aggregating:
  NULLIF(REGEXP_REPLACE(col, '[^0-9.]', '', 'g'), '')::NUMERIC
  Never compare a text column to a number directly.
- Cast category columns (bedroom counts, ids, dates) to text so they can label an axis.
- Do NOT invent restrictive filters unless the user asks for them.
- Give every output column a clear snake_case alias."""


def _parse_json(content: str) -> Dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise RuntimeError("The model did not return valid JSON. Please try again.")


def llm_json(system: str, user: str, max_tokens: int = 1800) -> Dict[str, Any]:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.1,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    content = resp.choices[0].message.content or ""
    if not content.strip():
        raise RuntimeError("The model returned an empty response. Please try again.")
    return _parse_json(content)


def llm_text(system: str, user: str, max_tokens: int = 800) -> str:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.3,
        max_tokens=max_tokens,
    )
    return (resp.choices[0].message.content or "").strip()


def plan_analysis(
    question: str, viz_mode: str, schema_text: str, error_feedback: Optional[str]
) -> Dict[str, Any]:
    if viz_mode in CHART_TYPES:
        viz_rule = (
            f'The user chose the "{viz_mode}" chart. Set chart_type to "{viz_mode}" '
            "and shape the query so the result fits that chart."
        )
    else:
        viz_rule = "Choose the chart_type that best fits the question and the data."

    system = f"""You are SenPie, an expert PostgreSQL analytics planner for a dashboard.
Database schema:

{schema_text}

Rules:
{DATA_RULES}
- Charts must stay readable. For comparisons across categories, ORDER BY the main metric DESC and LIMIT 12 (pie: LIMIT 6). Only time series may return more rows, ordered by time.
- bar/line/area: one category or time column plus one or more numeric columns (at most 4).
- pie: one category column and exactly one numeric column.
- heatmap: one category column plus two or more numeric columns.
- Use display "table" when the user asks to list, show or see records or details, asks for "all" of something with many categories, or when the result has many text columns or more than 4 numeric columns. For tables use LIMIT 100 unless they ask for fewer. Otherwise use display "chart".
- {viz_rule}

Respond with a JSON object only, with these keys:
  "needs_query": boolean (false for greetings, small talk or anything not about the data),
  "direct_answer": string (used only when needs_query is false: reply in 1-2 friendly sentences; for a greeting, greet back and suggest one example question about the tables above; never say there is no data),
  "sql": string,
  "chart_type": one of {CHART_TYPES},
  "display": "chart" or "table",
  "title": short chart title,
  "description": one-line chart subtitle,
  "x_key": the result column for the category / x axis (must equal a SQL alias),
  "value_keys": array of numeric result columns to plot (must equal SQL aliases)."""

    user = question if not error_feedback else f"{question}\n\n{error_feedback}\nFix the query."
    return llm_json(system, user)


def summarize(question: str, sql: str, rows: List[Dict[str, Any]], deep: bool) -> str:
    system = (
        "You are SenPie, an enterprise data analyst. Answer using ONLY the query results provided. "
        "Do not invent numbers or causes the data does not show. "
        "Write plain text only: no markdown, no tables, no asterisks, no headings. "
        + (
            "Give a thorough answer: key figures, outliers or variances, and likely drivers the data supports. "
            "Up to 6 sentences."
            if deep
            else "Be concise: 2 to 3 sentences with the key figures."
        )
    )
    payload = f"Question: {question}\n\nSQL:\n{sql}\n\nResults (up to 40 rows):\n{json.dumps(rows[:40], default=str)}"
    return llm_text(system, payload, max_tokens=1000 if deep else 700)


# -------------------------------------------------------------- pipeline ----
def _is_numeric_col(rows: List[Dict[str, Any]], col: str) -> bool:
    values = [r[col] for r in rows if r[col] is not None]
    return bool(values) and all(
        isinstance(v, (int, float)) and not isinstance(v, bool) for v in values
    )


def _label(key: str) -> str:
    return key.replace("_", " ").title()


# ------------------------------------------------ chart-vs-table guard ----
PIE_MAX = 8                  # more slices than this is unreadable
BAR_MAX = 15                 # bars shown when a category chart has more rows
CATEGORY_TABLE_LIMIT = 40    # beyond this many categories, show a table instead
SERIES_MAX = 120             # max points for a time series chart
MAX_SERIES = 5               # max series (value columns) in one chart

_TEMPORAL = re.compile(
    r"^(\d{4}([-/]\d{1,2}([-/]\d{1,2})?)?([T ].*)?|"
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(\s+\d{2,4})?)$",
    re.IGNORECASE,
)


def _looks_temporal(values: List[Any]) -> bool:
    sample = [str(v).strip() for v in values if v is not None][:10]
    return bool(sample) and all(_TEMPORAL.match(v) for v in sample)


def _round_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in row.items()}


def decide_display(
    plan: Dict[str, Any],
    rows: List[Dict[str, Any]],
    x_key: str,
    value_keys: List[str],
    viz_mode: str,
) -> Dict[str, Any]:
    """Server-side guard so the dashboard never draws an unreadable chart."""
    n = len(rows)
    explicit = viz_mode in CHART_TYPES
    chart_type = viz_mode if explicit else plan.get("chart_type")
    if chart_type not in CHART_TYPES:
        chart_type = "bar"

    def as_table(note: str = "", display: str = "table") -> Dict[str, Any]:
        return {"display": display, "chart_type": None, "chart_rows": [], "value_keys": [], "note": note}

    if n == 1 and len(value_keys) <= 1:
        return as_table(display="none")  # a single value reads best as plain text
    if not value_keys:
        return as_table()
    if not explicit and plan.get("display") == "table":
        return as_table()

    value_keys = value_keys[:MAX_SERIES]
    temporal = _looks_temporal([r[x_key] for r in rows])
    chart_rows = rows
    note = ""

    if chart_type in ("line", "area"):
        if n < 2 or n > SERIES_MAX:
            return as_table(f"{n} points does not make a readable line chart, so I'm showing a table.")
    else:
        if chart_type == "pie":
            first = value_keys[0]
            if n < 2 or any((r[first] or 0) < 0 for r in rows):
                chart_type = "bar"
            elif n > PIE_MAX:
                chart_type = "bar"
                note = f"A pie chart gets unreadable with {n} categories, so I used a bar chart instead."
            else:
                value_keys = value_keys[:1]
        if n > (SERIES_MAX if temporal else CATEGORY_TABLE_LIMIT):
            return as_table(
                f"{n} rows is too many categories to chart readably, so I'm showing a table. "
                "Ask for a top 10 or add a filter if you want a chart."
            )
        limit = SERIES_MAX if temporal else (20 if chart_type == "heatmap" else BAR_MAX)
        if n > limit:
            chart_rows = sorted(rows, key=lambda r: r[value_keys[0]] or 0, reverse=True)[:limit]
            note = (note + " " if note else "") + (
                f"The chart shows the top {limit} of {n} rows. The full result is in the Data Grid tab."
            )

    return {
        "display": "chart",
        "chart_type": chart_type,
        "chart_rows": chart_rows,
        "value_keys": value_keys,
        "note": note,
    }


def build_table(title: str, columns: List[str], rows: List[Dict[str, Any]], capped: bool) -> Dict[str, Any]:
    return {
        "title": title,
        "columns": [
            {"key": c, "label": _label(c), "numeric": _is_numeric_col(rows, c)} for c in columns
        ],
        "rows": rows,
        "total_rows": len(rows),
        "capped": capped,
    }


def run_pipeline(req: ChatRequest) -> ChatResponse:
    viz_mode = req.visualization or req.chart_type or "auto"
    schema = get_schema_info()
    steps = [
        ResearchStep(
            step="Live Schema Introspection",
            detail=f"Scanned {schema['table_count']} tables from the connected database",
        )
    ]

    error_feedback: Optional[str] = None
    last_error: Optional[Exception] = None
    plan: Dict[str, Any] = {}
    columns: List[str] = []
    rows: List[Dict[str, Any]] = []
    elapsed_ms = 0
    sql = ""

    for attempt in range(2):  # one retry, feeding the problem back to the model
        plan = plan_analysis(req.query, viz_mode, schema["text"], error_feedback)
        if not plan.get("needs_query"):
            return ChatResponse(
                answer=plan.get("direct_answer")
                or "Hi! Ask me a question about your data and I'll chart it."
            )
        sql = (plan.get("sql") or "").strip()
        try:
            columns, rows, elapsed_ms = run_readonly_query(sql)
        except Exception as exc:
            last_error = exc
            reason = getattr(exc, "orig", exc)
            error_feedback = f"The previous SQL failed: {reason}\nPrevious SQL:\n{sql}"
            logger.warning("SQL attempt failed: %s", reason)
            continue
        last_error = None
        if rows or attempt == 1:
            break
        error_feedback = (
            f"The previous SQL returned 0 rows:\n{sql}\n"
            "Check the sample rows for the real value formats (text columns holding numbers or "
            "currency, different spellings) and relax the filters."
        )

    if last_error is not None:
        raise last_error

    steps.append(ResearchStep(step="SQL Execution", detail=sql))
    steps.append(
        ResearchStep(
            step="Visualization Canvas Mapped",
            detail=f"Extracted {len(rows)} rows in {elapsed_ms} ms",
        )
    )

    if not rows:
        return ChatResponse(
            answer="The query ran but returned no rows. Try rephrasing your question.",
            sql_executed=sql,
            data_results=[],
            research_steps=steps if req.deep_research else None,
        )

    # ---- decide how to show the result: chart, table or plain text ----
    rows = [_round_row(r) for r in rows]
    x_key = plan.get("x_key") if plan.get("x_key") in columns else columns[0]
    numeric = [c for c in columns if c != x_key and _is_numeric_col(rows, c)]
    value_keys = [k for k in (plan.get("value_keys") or []) if k in numeric] or numeric

    decision = decide_display(plan, rows, x_key, value_keys, viz_mode)
    title = plan.get("title") or f"Analysis: {req.query}"
    table = build_table(title, columns, rows, len(rows) >= MAX_ROWS)

    chart: Optional[Dict[str, Any]] = None
    chart_meta: Optional[Dict[str, Any]] = None
    if decision["display"] == "chart":
        keys = decision["value_keys"]
        chart = {
            "id": f"chart-{int(time.time() * 1000)}",
            "title": title,
            "description": plan.get("description") or req.query,
            "type": decision["chart_type"],
            "xAxisKey": x_key,
            "dataKeys": [
                {"key": k, "label": _label(k), "color": PALETTE[i % len(PALETTE)]}
                for i, k in enumerate(keys)
            ],
            "data": decision["chart_rows"],
        }
        chart_meta = {
            "title": title,
            "xAxisKey": x_key,
            "yAxisKey": keys[0],
            "chartType": decision["chart_type"],
        }

    steps.append(
        ResearchStep(
            step="Visualization Planner",
            detail=(
                f"Chose a {decision['chart_type']} chart"
                if chart
                else "Chose a table" if decision["display"] == "table" else "Answered in text"
            ),
        )
    )

    answer = summarize(req.query, sql, rows, req.deep_research)
    if decision["note"]:
        answer += "\n\n" + decision["note"]

    return ChatResponse(
        answer=answer,
        sql_executed=sql,
        data_results=rows,
        chart_meta=chart_meta,
        chart=chart,
        table=table,
        display=decision["display"],
        research_steps=steps if req.deep_research else None,
    )


# ------------------------------------------------------------------ KPIs ----
_kpi_cache: Optional[List[Dict[str, str]]] = None


def _fmt_kpi(value: Any, fmt: str) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return str(value)
    if fmt == "currency":
        return f"${n:,.0f}" if abs(n) >= 1000 else f"${n:,.2f}"
    if fmt == "percent":
        return f"{n:.1f}%"
    if fmt == "decimal":
        return f"{n:,.2f}"
    return f"{n:,.0f}"


def build_kpis() -> List[Dict[str, str]]:
    schema = get_schema_info()
    system = f"""You choose headline metrics for a dashboard over this PostgreSQL database:

{schema['text']}

Pick the 3 most meaningful headline metrics (totals, averages, counts). Rules:
{DATA_RULES}
- Each SQL must return exactly one row with exactly one numeric column.

Respond with a JSON object only: {{"kpis": [{{"label": string, "sql": string, "format": "number" | "currency" | "percent" | "decimal"}}, ...]}} with exactly 3 items."""
    plan = llm_json(system, "Choose the 3 headline metrics.")
    kpis: List[Dict[str, str]] = []
    for item in plan.get("kpis", [])[:3]:
        try:
            cols, rows, _ = run_readonly_query(item["sql"])
            if rows and cols:
                kpis.append(
                    {"label": item["label"], "value": _fmt_kpi(rows[0][cols[0]], item.get("format", "number"))}
                )
        except Exception as exc:
            logger.warning("KPI failed (%s): %s", item.get("label"), getattr(exc, "orig", exc))
    return kpis


# ------------------------------------------------------------- endpoints ----
@app.get("/")
def health():
    return {"status": "ok"}


@app.get("/api/db-info")
def db_info():
    """Real database name, table count and row count for the sidebar."""
    stats = get_db_stats()
    return {**stats, "status": "Ready" if stats["connected"] else "Offline"}


@app.get("/api/kpis")
def kpis(refresh: bool = False):
    """Headline metrics chosen by the LLM from your real schema (cached)."""
    global _kpi_cache
    if engine is None or not os.getenv("GROQ_API_KEY"):
        return {"kpis": []}
    if _kpi_cache is None or refresh:
        try:
            _kpi_cache = build_kpis()
        except Exception:
            logger.exception("KPI generation failed")
            return {"kpis": []}
    return {"kpis": _kpi_cache}


@app.get("/api/schema")
def schema():
    """Quick check that the database connection and schema reading work."""
    info = get_schema_info(refresh=True)
    return {"tables": info["tables"], "table_count": info["table_count"]}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    missing = []
    if engine is None:
        missing.append("DATABASE_URL")
    if not os.getenv("GROQ_API_KEY"):
        missing.append("GROQ_API_KEY")
    if missing:
        return ChatResponse(
            answer=f"⚠️ Backend setup incomplete: set {', '.join(missing)} in backend/.env and restart the server."
        )

    try:
        return run_pipeline(req)
    except Exception as exc:
        logger.exception("chat pipeline failed")
        reason = str(getattr(exc, "orig", exc)).splitlines()[0]
        return ChatResponse(answer=f"⚠️ I couldn't complete that analysis: {reason}")

"""SenPie database layer: schema introspection + guarded read-only queries."""
import json
import os
import re
import time
from datetime import date, datetime, time as dtime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
# Plain "postgresql://" selects psycopg2; this project uses psycopg 3
if DATABASE_URL and DATABASE_URL.startswith(("postgresql://", "postgres://")):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.split("://", 1)[1]
DB_SCHEMA = os.getenv("DB_SCHEMA", "public")
MAX_ROWS = int(os.getenv("MAX_ROWS", "200"))
STATEMENT_TIMEOUT_MS = int(os.getenv("STATEMENT_TIMEOUT_MS", "5000"))

engine: Optional[Engine] = (
    create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Dependency to get a DB session in FastAPI endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------------------------------------- helpers ------
def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, dtime)):
        return value.isoformat()
    if value is None or isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _sample_text(table: str) -> str:
    """Two example rows (truncated) so the LLM sees real value formats."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            result = conn.execute(
                text(f"SELECT * FROM {_quote(DB_SCHEMA)}.{_quote(table)} LIMIT 2")
            )
            cols = list(result.keys())
            lines = []
            for row in result.fetchall():
                item = {}
                for c, v in zip(cols, row):
                    if v is None:
                        continue
                    v = _jsonable(v)
                    if isinstance(v, str) and len(v) > 40:
                        v = v[:40] + "..."
                    item[c] = v
                lines.append("  sample: " + json.dumps(item, ensure_ascii=False))
            conn.rollback()
            return "\n".join(lines)
    except Exception:
        return ""


# --------------------------------------------------------------- schema -----
_schema_cache: Optional[Dict[str, Any]] = None


def get_schema_info(refresh: bool = False) -> Dict[str, Any]:
    """Describe tables/columns/foreign keys/sample rows for the LLM."""
    global _schema_cache
    if engine is None:
        raise RuntimeError("DATABASE_URL is not set")
    if _schema_cache is not None and not refresh:
        return _schema_cache

    insp = inspect(engine)
    tables = sorted(insp.get_table_names(schema=DB_SCHEMA))
    views = sorted(insp.get_view_names(schema=DB_SCHEMA))

    lines: List[str] = []
    for name in tables + views:
        cols = ", ".join(
            f"{c['name']} {c['type']}" for c in insp.get_columns(name, schema=DB_SCHEMA)
        )
        line = f"TABLE {name} ({cols})"
        try:
            for fk in insp.get_foreign_keys(name, schema=DB_SCHEMA):
                line += (
                    f"\n  FK: {', '.join(fk['constrained_columns'])} -> "
                    f"{fk['referred_table']}({', '.join(fk['referred_columns'])})"
                )
        except Exception:
            pass  # views have no foreign keys
        sample = _sample_text(name)
        if sample:
            line += "\n" + sample
        lines.append(line)

    _schema_cache = {
        "text": "\n".join(lines),
        "table_count": len(tables),
        "tables": tables + views,
        "base_tables": tables,
    }
    return _schema_cache


def get_db_stats() -> Dict[str, Any]:
    """Connection status, database name, table count and row count for the sidebar."""
    empty = {"connected": False, "name": None, "table_count": 0, "row_count": 0}
    if engine is None:
        return empty
    try:
        info = get_schema_info()
        with engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            estimate = conn.execute(
                text(
                    "SELECT COALESCE(SUM(GREATEST(c.reltuples, 0)), 0)::bigint "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = :s AND c.relkind IN ('r', 'p')"
                ),
                {"s": DB_SCHEMA},
            ).scalar() or 0
            conn.rollback()

        total = int(estimate)
        if total == 0:  # tables never ANALYZEd report 0, so count exactly
            for table in info["base_tables"]:
                try:
                    with engine.connect() as conn:
                        conn.execute(text("SET TRANSACTION READ ONLY"))
                        total += int(
                            conn.execute(
                                text(f"SELECT COUNT(*) FROM {_quote(DB_SCHEMA)}.{_quote(table)}")
                            ).scalar()
                            or 0
                        )
                        conn.rollback()
                except Exception:
                    pass
        return {
            "connected": True,
            "name": engine.url.database,
            "table_count": info["table_count"],
            "row_count": total,
        }
    except Exception:
        return empty


# ---------------------------------------------------------------- safety ----
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|"
    r"execute|merge|vacuum|lock|listen|notify|reset|set|do)\b|\bpg_\w+",
    re.IGNORECASE,
)


def validate_sql(sql: str) -> str:
    """Allow a single SELECT / WITH statement only. Returns the cleaned SQL."""
    cleaned = (sql or "").strip().rstrip(";").strip()
    if not cleaned:
        raise ValueError("The model did not produce any SQL.")
    if ";" in cleaned:
        raise ValueError("Only a single SQL statement is allowed.")
    if not re.match(r"^(select|with)\b", cleaned, re.IGNORECASE):
        raise ValueError("Only SELECT queries are allowed.")
    if _FORBIDDEN.search(cleaned):
        raise ValueError("The query contains a keyword that is not allowed.")
    return cleaned


# ------------------------------------------------------------- execution ----
def run_readonly_query(sql: str) -> Tuple[List[str], List[Dict[str, Any]], int]:
    """Run validated SQL in a READ ONLY transaction with timeout + row cap."""
    if engine is None:
        raise RuntimeError("DATABASE_URL is not set")

    inner = validate_sql(sql)
    wrapped = f"SELECT * FROM ({inner}) AS _senpie_q LIMIT {MAX_ROWS}"

    start = time.perf_counter()
    with engine.connect() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        conn.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        result = conn.execute(text(wrapped))
        columns = list(result.keys())
        rows = [
            {c: _jsonable(v) for c, v in zip(columns, row)}
            for row in result.fetchall()
        ]
        conn.rollback()
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return columns, rows, elapsed_ms
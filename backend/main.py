from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, text, inspect
import os
import json
import re

app = FastAPI(title="SenPie Open-Source AI Analytics API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Groq Client (using openai/gpt-oss-20b or standard models supported by Groq)
client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY", "gsk_YourRealKeyHere")
)

# Database configuration (Connects dynamically to your active PostgreSQL URL)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:ascend101@localhost:5432/airbnb_db")
engine = create_engine(DATABASE_URL)

def get_db():
    db = Session(bind=engine)
    try:
        yield db
    finally:
        db.close()

def get_dynamic_schema_context(eng) -> str:
    """Dynamically introspects ANY connected PostgreSQL database to map tables and columns automatically."""
    try:
        inspector = inspect(eng)
        tables = inspector.get_table_names()
        schema_desc = "Connected Database Schema:\n"
        for table in tables:
            schema_desc += f"- Table: {table}\n  Columns:\n"
            columns = inspector.get_columns(table)
            for col in columns:
                schema_desc += f"    * {col['name']} ({col['type']})\n"
        return schema_desc
    except Exception as e:
        return f"Error introspecting schema: {str(e)}"

class ChatRequest(BaseModel):
    query: str
    deep_research: bool = False
    chart_type: str = "auto"

class ResearchStep(BaseModel):
    step: str
    detail: str
    status: str = "completed"

class ChatResponse(BaseModel):
    answer: str
    model_used: str
    sql_executed: Optional[str] = None
    data_results: Optional[List[Dict[str, Any]]] = None
    chart_meta: Optional[Dict[str, Any]] = None
    research_steps: Optional[List[ResearchStep]] = None

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    try:
        # Step 1: Check if the user's message is a greeting or general chat
        lower_query = req.query.strip().lower()
        greetings = ["hi", "hello", "hey", "sup", "good morning", "good evening", "greetings"]
        
        if lower_query in greetings or len(lower_query) < 3:
            return ChatResponse(
                answer="Hello! 👋 I'm SenPie, your AI database analytics assistant. Ask me anything about your connected database (e.g., pricing trends, top listings, or summaries), and I'll generate live charts and insights for you!",
                model_used="openai/gpt-oss-20b"
            )

        # Step 2: Automatically scan the database schema live for analytical requests
        schema_context = get_dynamic_schema_context(engine)

        # Step 3: Prompt LLM to convert user natural language into SQL
        sql_prompt = (
            "You are SenPie, an expert open-source AI database analyst. "
            "Convert the user's natural language question into a valid, read-only PostgreSQL query "
            "targeting the correct table and columns from the schema provided below. "
            "Return ONLY the raw SQL query inside a markdown code block (e.g. ```sql ... ```). "
            "Limit results to a maximum of 50 rows if it returns a list. "
            f"{schema_context}\n"
            f"User Question: {req.query}"
        )

        sql_completion = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": sql_prompt}],
            temperature=0.1,
            max_tokens=300
        )

        raw_sql_response = sql_completion.choices[0].message.content
        
        # Extract SQL from markdown code block cleanly
        sql_match = re.search(r"```(?:sql)?\s*(.*?)\s*```", raw_sql_response, re.DOTALL)
        generated_sql = sql_match.group(1).strip() if sql_match else raw_sql_response.strip()

        # Strict security guardrails against destructive operations
        forbidden_keywords = ["drop", "delete", "update", "insert", "alter", "truncate", "grant", "create"]
        if any(word in generated_sql.lower() for word in forbidden_keywords):
            raise HTTPException(status_code=400, detail="Unsafe database operation blocked.")

        # Step 4: Execute query live against PostgreSQL
        data_rows = []
        if generated_sql.lower().startswith("select"):
            result = db.execute(text(generated_sql))
            data_rows = [dict(row._mapping) for row in result]

        # Step 5: Automatically map chart structure from query results
        chart_meta = None
        if data_rows and len(data_rows) > 0:
            keys = list(data_rows[0].keys())
            if len(keys) >= 2:
                chart_meta = {
                    "title": f"Analysis: {req.query}",
                    "xAxisKey": keys[0],
                    "yAxisKey": keys[1],
                    "chartType": req.chart_type
                }

        # Step 6: Summarize findings for the chat response
        summary_prompt = (
            "You are SenPie, an enterprise AI database analytics assistant. "
            f"User Question: {req.query}\n"
            f"SQL Executed: {generated_sql}\n"
            f"Query Results Sample (JSON): {json.dumps(data_rows[:15], default=str)}\n"
            "Provide a clear, concise, data-driven analytical answer summarizing these results."
        )

        summary_completion = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": summary_prompt}],
            temperature=0.3,
            max_tokens=400
        )

        ai_answer = summary_completion.choices[0].message.content

        return ChatResponse(
            answer=ai_answer,
            model_used="openai/gpt-oss-20b",
            sql_executed=generated_sql,
            data_results=data_rows,
            chart_meta=chart_meta,
            research_steps=[
                ResearchStep(step="Live Schema Introspection", detail="Scanned connected PostgreSQL tables automatically"),
                ResearchStep(step="SQL Execution", detail=generated_sql),
                ResearchStep(step="Visualization Canvas Mapped", detail=f"Successfully extracted {len(data_rows)} rows")
            ] if req.deep_research else None
        )

    except Exception as e:
        return ChatResponse(
            answer=f"⚠️ Backend Execution Error: {str(e)}",
            model_used="openai/gpt-oss-20b"
        )
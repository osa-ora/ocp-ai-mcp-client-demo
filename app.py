from fastapi import FastAPI
import os
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from contextlib import asynccontextmanager
import asyncio

from mcp_discovery import discover_all_servers
from mcpconfig import MCP_SERVERS, SHOW_TOOL_TRACE
from agent import run_agent, init
from typing import Any, Dict, Optional


# ----------------------------
# BASE PATH
# ----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ----------------------------
# STATE
# ----------------------------
cached_servers = []


# =========================================================
# MCP HEALTH CHECK
# =========================================================
async def check_server_health(server: dict) -> dict:
    """
    Try a lightweight check to see if MCP server is alive.
    """
    try:
        # very cheap connectivity check (no tool loading)
        # we rely on discovery already
        if server.get("url"):
            return {
                **server,
                "status": "up"
            }
        return {
            **server,
            "status": "down"
        }

    except Exception:
        return {
            **server,
            "status": "down"
        }


# ----------------------------
# LIFESPAN (MCP discovery)
# ----------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global cached_servers

    try:
        cached_servers = await discover_all_servers()

        # enrich with status safely
        checked = await asyncio.gather(
            *(check_server_health(s) for s in cached_servers)
        )

        cached_servers = checked

    except Exception as e:
        print(f"[MCP] discovery failed: {e}")
        cached_servers = []

    await init()

    yield


# ----------------------------
# APP
# ----------------------------
app = FastAPI(lifespan=lifespan)


# ----------------------------
# STATIC FILES
# ----------------------------
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "static")),
    name="static"
)

# ---------------------------------
# SKILL CARD FOR OTHER AGENTS (A2A)
# ---------------------------------
@app.get("/.well-known/agent.json")
async def agent_card():
    return await build_agent_card_from_mcp_servers()


async def build_agent_card_from_mcp_servers():
    servers = await discover_all_servers() or []

    return {
        "name": "Dynamic MCP Orchestrator",
        "description": "Orchestrates MCP tool ecosystem dynamically.",
        "capabilities": [
            {
                "domain": s.get("name", "unknown"),
                "description": s.get("description", ""),
                "examples": s.get("examples", [])
            }
            for s in servers
            if s.get("status") == "up"
        ]
    }

# ---------------------------------
# EXECUTION ENTRY FOR OTHER AGENTS (A2A)
# ---------------------------------

class TaskRequest(BaseModel):
    id: Optional[str] = None
    input: str
    context: Dict[str, Any] = {}
    
def build_task_response(task_id, result):
    return {
        "id": task_id,
        "status": "completed",
        "output": result.get("answer"),
        "artifacts": {
            "tool_trace": result.get("tools", []),
            "raw": result
        }
    }

@app.post("/task")
async def task(req: TaskRequest):
    result = await run_agent(req.input)

    return build_task_response(req.id, result)
    
# ----------------------------
# REQUEST MODEL
# ----------------------------
class ChatRequest(BaseModel):
    message: str


# ----------------------------
# HOME PAGE
# ----------------------------
@app.get("/", response_class=HTMLResponse)
def home():
    file_path = os.path.join(BASE_DIR, "templates", "index.html")
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


# ----------------------------
# MCP SERVERS (WITH STATUS)
# ----------------------------
@app.get("/servers")
async def get_servers():
    return {
        "servers": await discover_all_servers()
    }


# ----------------------------
# REFRESH SERVERS
# ----------------------------
@app.post("/refresh")
async def refresh_servers():
    global cached_servers

    try:
        cached_servers = await discover_all_servers()

        cached_servers = await asyncio.gather(
            *(check_server_health(s) for s in cached_servers)
        )

    except Exception as e:
        print(f"[MCP] refresh failed: {e}")
        cached_servers = []

    return {"servers": cached_servers}


# ----------------------------
# CHAT ENDPOINT
# ----------------------------
@app.post("/chat")
async def chat(request: ChatRequest):

    print(f"Agent received: {request.message}")

    result = await run_agent(request.message)

    answer = result.get("answer")

    # -------------------------------------------------
    # HARD CONTRACT NORMALIZATION
    # -------------------------------------------------
    if not isinstance(answer, str) or not answer.strip() or answer.strip() == "{}" or answer.strip() == "{ }":
        answer = "Hi 👋 Kindly chat with me about available MCP tools!"

    response = {
        "response": answer
    }

    # ONLY optional tool trace (NOT server status)
    if SHOW_TOOL_TRACE:
        response["tools"] = result.get("tools", [])

    return response
# ----------------------------
# RUNTIME INVOCATION (At the absolute bottom of app.py)
# ----------------------------
if __name__ == "__main__":
    import uvicorn
    # Dynamically read port from environment if the cloud platform injects it, default to 8100
    port = int(os.getenv("PORT", 8081))
    print(f"🚀 Starting server on 0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
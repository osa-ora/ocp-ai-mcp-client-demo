import json
import asyncio
import re
import traceback
from typing import TypedDict, Optional, Any, Dict, List
from langgraph.graph import StateGraph, END
from langchain_mcp_adapters.client import MultiServerMCPClient
from jinja2 import Template

# Config import
from mcpconfig import MODEL_NAME, DEBUG, MAX_STEPS, MCP_SERVERS, LLM_PROVIDER, LLM_BASE_URL, LLM_API_KEY
# LLM imports
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

# =========================================================
# CONFIG
# =========================================================
class Config:
    model_name = MODEL_NAME
    debug = DEBUG
    max_steps = MAX_STEPS

    # LLM settings
    # ollama | openai
    provider = LLM_PROVIDER          
    base_url = LLM_BASE_URL
    api_key = LLM_API_KEY

# =========================================================
# CACHE
# =========================================================
class Cache:
    tools = []
    skill_map = {}
    valid_skills = set()


CACHE = Cache()
CACHE_LOCK = asyncio.Lock()
# =========================================================
# SERVER HEALTH
# =========================================================
SERVER_HEALTH: Dict[str, str] = {}


def debug(msg: str, force: bool = False):
    if Config.debug or force:
        print(msg)


def build_skill_map(tools):
    skill_map = {}

    for t in tools:
        metadata = getattr(t, "metadata", None) or {}
        skill = metadata.get("skill", "general")

        tool_spec = {
            "name": t.name,
            "description": str(t.description),
            "parameters": getattr(t, "args_schema", None) or {}
        }

        skill_map.setdefault(skill, []).append(tool_spec)

    return skill_map

# =========================================================
# TOOL CACHE REFRESH LOOP
# =========================================================
async def refresh_tool_cache_loop(interval: int = 100):
    try:
        while True:
            try:
                debug("[CACHE] Refreshing MCP tools...", force=True)

                tools = []
                new_health = {}

                for server in MCP_SERVERS:
                    try:
                        transport = server["transport"]
                        if transport == "http":
                            transport = "streamable_http"

                        client = MultiServerMCPClient({
                            server["name"]: {
                                "transport": transport,
                                "url": server["url"]
                            }
                        })

                        server_tools = await client.get_tools()

                        new_health[server["name"]] = "online"

                        for t in server_tools:
                            meta = getattr(t, "metadata", None)
                            if not isinstance(meta, dict):
                                meta = {}

                            meta["server"] = server["name"]
                            setattr(t, "metadata", meta)

                        tools.extend(server_tools)

                    except Exception as e:
                        debug(f"[CACHE REFRESH] {server['name']} failed: {repr(e)}", force=True)
                        new_health[server["name"]] = "offline"

                async with CACHE_LOCK:
                    # Explicit Memory Clearance: sever connections to old tool objects
                    CACHE.tools.clear()
                    CACHE.skill_map.clear()
                    CACHE.valid_skills.clear()

                    # Bind fresh data
                    CACHE.tools = tools
                    SERVER_HEALTH.update(new_health)

                    if CACHE.tools:
                        CACHE.skill_map = build_skill_map(CACHE.tools)
                        CACHE.valid_skills = set(CACHE.skill_map.keys())

                debug(f"[CACHE] Refresh complete. Total active tools in memory: {len(tools)}", force=True)
                for s_name, status in new_health.items():
                    debug(f"  -> Server '{s_name}' is currently: {status.upper()}", force=True)

            except Exception as e:
                debug(f"[CACHE LOOP ERROR] Fatal iteration crash: {repr(e)}", force=True)

            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        debug("[CACHE] Background refresh worker shut down gracefully.", force=True)

# =========================================================
# PROMPT RENDERING
# =========================================================
def render_prompt(path: str, context: dict) -> str:
    with open(path, "r") as f:
        template = Template(f.read())
        return template.render(**context)


# =========================================================
# STATE
# =========================================================
class HRState(TypedDict):
    user_input: str
    tools: List[Any]
    tool_schemas: Optional[Dict[str, Any]]
    selected_skills: Optional[List[str]]
    plan: Optional[Dict[str, Any]]
    tool_result: Optional[Any]
    final_answer: Optional[str]
    steps: int
    last_tool: Optional[str]
    visited_tools: List[str]

    history: List[Dict[str, Any]]
    tool_trace: List[Dict[str, str]]


# =========================================================
# MCP CLIENT
# =========================================================
def build_mcp_client():
    servers = {}
    for s in MCP_SERVERS:
        servers[s["name"]] = {
            "transport": s["transport"],
            "url": s["url"]
        }
    return MultiServerMCPClient(servers)


mcp_client = build_mcp_client()

# =========================================================
# LLM FACTORY
# =========================================================
def build_llm(
    temperature: float = 0,
    json_mode: bool = False
):
    print(f"Selected provider: {Config.provider}")
    if Config.provider == "ollama":

        kwargs = {
            "model": Config.model_name,
            "base_url": Config.base_url,
            "temperature": temperature
        }

        if json_mode:
            kwargs["format"] = "json"

        return ChatOllama(**kwargs)

    elif Config.provider == "openai":

        return ChatOpenAI(
            model=Config.model_name,
            api_key=Config.api_key,
            base_url=Config.base_url,
            temperature=temperature,
            max_retries=5,
            timeout=60.0
        )

    raise ValueError(
        f"Unsupported provider: {Config.provider}"
    )


# Planner / Router LLM
llm = build_llm(
    temperature=0,
    json_mode=True
)

# Response LLM - Ollama Natural Text Mode Enabled
friendly_llm = build_llm(
    temperature=0.5,
    json_mode=True
)

# =========================================================
# TOOL CACHE LOADING
# =========================================================
async def load_tool_cache():
    tools = []

    for server in MCP_SERVERS:
        try:
            debug(f"[MCP] Connecting to {server['name']}...")

            transport = server["transport"]
            if transport == "http":
                transport = "streamable_http"

            client = MultiServerMCPClient({
                server["name"]: {
                    "transport": transport,
                    "url": server["url"]
                }
            })

            server_tools = await client.get_tools()

            # mark server ONLINE
            SERVER_HEALTH[server["name"]] = "online"

            for t in server_tools:
                meta = getattr(t, "metadata", None)
                if not isinstance(meta, dict):
                    meta = {}

                meta["server"] = server["name"]
                setattr(t, "metadata", meta)

            tools.extend(server_tools)

            debug(f"[MCP] OK {server['name']} → {len(server_tools)} tools")

        except Exception as e:
            debug(f"[MCP] WARNING {server['name']} failed: {repr(e)}")

            # mark server OFFLINE
            SERVER_HEALTH[server["name"]] = "offline"
            continue

    async with CACHE_LOCK:
        # Clear existing keys to guarantee a clean memory state at startup
        CACHE.tools.clear()
        CACHE.skill_map.clear()
        CACHE.valid_skills.clear()

        CACHE.tools = tools

        if not CACHE.tools:
            return

        CACHE.skill_map = build_skill_map(CACHE.tools)
        CACHE.valid_skills = set(CACHE.skill_map.keys())

    debug(f"[CACHE] Total tools loaded: {len(CACHE.tools)}")


# =========================================================
# SERVER HEALTH CHECK LOOP
# =========================================================
async def check_server_health(server: dict) -> dict:
    try:
        client = MultiServerMCPClient({
            server["name"]: {
                "transport": server["transport"],
                "url": server["url"]
            }
        })

        tools = await client.get_tools()

        tool_count = len(tools) if tools else 0

        return {
            **server,
            "status": "up" if tool_count > 0 else "down",
            "tool_count": tool_count
        }

    except Exception:
        return {
            **server,
            "status": "down",
            "tool_count": 0
        }

# =========================================================
# SKILL SELECTION
# =========================================================
async def select_skills(state: HRState):
    prompt = render_prompt(
        "prompts/skill_router.jinja2",
        {
            "valid_skills": list(CACHE.valid_skills),
            "user_input": state["user_input"]
        }
    )

    result = llm.invoke(prompt)

    try:
        data = parse_json_response(result.content)
        skills = data.get("skills", ["general"])
    except:
        skills = ["general"]

    state["selected_skills"] = skills
    return state


# =========================================================
# HELPERS
# =========================================================
def filter_allowed_tools(selected_skills: list) -> list:
    tools = []
    for skill in selected_skills:
        tools.extend(CACHE.skill_map.get(skill, []))
    return [t["name"] for t in tools]


def build_filtered_schemas(tool_names: list, active_tools: list) -> dict:
    schemas = {}

    for t in active_tools:
        if t.name in tool_names:
            schema = getattr(t, "args_schema", None)

            if hasattr(schema, "model_json_schema"):
                schema = schema.model_json_schema()
            elif hasattr(schema, "schema"):
                schema = schema.schema()

            schemas[t.name] = {
                "description": str(t.description),
                "parameters": schema or {}
            }

    return schemas


def sanitize_arguments(args: Any) -> dict:
    if not isinstance(args, dict):
        return {}

    return {
        k: v
        for k, v in args.items()
        if v is not None and str(v).lower() not in ["", "none", "null"]
    }


# =========================================================
# ROUTER
# =========================================================
def route_mcp_server(tool_name: str, active_tools: list) -> str:
    selected_server = "unknown"

    tool = next((t for t in active_tools if t.name == tool_name), None)

    if not tool:
        selected_server = (
            MCP_SERVERS[0]["name"]
            if MCP_SERVERS else "unknown"
        )
    else:
        meta = getattr(tool, "metadata", {}) or {}
        selected_server = meta.get(
            "server",
            MCP_SERVERS[0]["name"] if MCP_SERVERS else "unknown"
        )

    debug(f"[ROUTER] tool='{tool_name}' -> server='{selected_server}'")

    return selected_server

# =========================================================
# PLANNER
# =========================================================
async def planner(state: HRState):

    state["steps"] += 1

    tool_names = filter_allowed_tools(
        state.get("selected_skills", [])
    )

    state["tool_schemas"] = build_filtered_schemas(
        tool_names, state["tools"]
    )

    prompt = render_prompt(
        "prompts/planner.jinja2",
        {
            "user_input": state["user_input"],
            "tool_names": tool_names,
            "tool_schemas": json.dumps(
                state["tool_schemas"],
                indent=2
            ),
            "history": json.dumps(
                state["history"],
                indent=2
            )
        }
    )

    result = llm.invoke(prompt)

    try:
        plan = parse_json_response(result.content)
    except:
        plan = {
            "tool": "FINAL",
            "arguments": {}
        }

    plan["arguments"] = sanitize_arguments(
        plan.get("arguments", {})
    )

    state["plan"] = plan

    return state


# =========================================================
# EXECUTION
# =========================================================
async def execute_tool(state: HRState):

    tool_name = state["plan"]["tool"]
    args = state["plan"].get("arguments", {})

    tool = next((t for t in state["tools"] if t.name == tool_name), None)

    if not tool:
        state["tool_result"] = {"error": "Tool not found"}
        return state

    try:
        target_server = route_mcp_server(tool_name, state["tools"])

        result = await tool.ainvoke(args)

        output = getattr(result, "content", str(result))

        state["tool_result"] = output

        state["history"].append({
            "tool": tool_name,
            "server": target_server,
            "result": output
        })

        state["tool_trace"].append({
            "tool": tool_name,
            "server": target_server
        })

    except Exception as e:
        state["tool_result"] = {"error": str(e)}

    return state


# =========================================================
# ROUTER
# =========================================================
def route(state: HRState):
    if state["plan"]["tool"] == "FINAL":
        return "final"
    if state["steps"] >= Config.max_steps:
        return "final"
    return "execute"


# =========================================================
# FINAL RESPONSE
# =========================================================
def generate_response(state: HRState):

    prompt = render_prompt(
        "prompts/response.jinja2",
        {
            "user_input": state["user_input"],
            "history": json.dumps(
                state["history"],
                indent=2
            )
        }
    )

    result = friendly_llm.invoke(prompt)

    state["final_answer"] = result.content

    return state

# =========================================================
# JSON PARSER
# =========================================================
def parse_json_response(content: str) -> dict:

    if not content:
        return {}

    # Basic stripping of backticks
    cleaned = (
        content
        .replace("```json", "")
        .replace("```JSON", "")
        .replace("```", "")
        .strip()
    )

    try:
        # Regex extracts the raw bracket to bracket payload, completely avoiding
        # conversational preambles or markdown block headers
        match = re.search(r"(\{.*\})", cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        return json.loads(cleaned)
    except Exception:
        return {}

# =========================================================
# GRAPH
# =========================================================
def build_graph():

    g = StateGraph(HRState)

    g.add_node("skill", select_skills)
    g.add_node("plan", planner)
    g.add_node("exec", execute_tool)
    g.add_node("final", generate_response)

    g.set_entry_point("skill")

    g.add_edge("skill", "plan")
    g.add_conditional_edges("plan", route, {
        "execute": "exec",
        "final": "final"
    })
    g.add_edge("exec", "plan")
    g.add_edge("final", END)

    return g.compile()


GRAPH = build_graph()


# =========================================================
# INIT
# =========================================================
async def init():
    # Load primary tool mapping right during standard startup
    await load_tool_cache()
    
    # Securely deploy background loops inside the active running loop container
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(refresh_tool_cache_loop(interval=30))
        debug("[AGENT SYSTEM] Successfully deployed loop task to active worker runtime engine.", force=True)
    except Exception as loop_err:
        print(f"[AGENT SYSTEM CRITICAL] Failed initializing autonomous context task loop: {repr(loop_err)}")


# =========================================================
# PUBLIC API
# =========================================================
async def run_agent(query: str):
    
    # Quick, thread-safe memory snapshot of the tools
    async with CACHE_LOCK:
        snapshot_tools = list(CACHE.tools)
    
    try:
        result = await GRAPH.ainvoke({
            "user_input": query,
            "tools": snapshot_tools,
            "tool_schemas": None,
            "selected_skills": None,
            "plan": None,
            "tool_result": None,
            "final_answer": None,
            "steps": 0,
            "last_tool": None,
            "visited_tools": [],
            "history": [],
            "tool_trace": []
        })
        
        return {
            "answer": result["final_answer"],
            "tools": result["tool_trace"],
            "error": None
        }

    except Exception as e:
        full_traceback = traceback.format_exc()
        error_msg = str(e) if str(e) else repr(e)
        debug(f"[AGENT CRASH INTERCEPTED]\n{full_traceback}", force=True)        
        return {
            "answer": f"<span style='color: red; font-weight: bold;'>Error: {error_msg}</span>",
            "tools": [],
            "error": error_msg
        }


# =========================================================
# SERVER STATUS EXPORT (FOR /SERVERS API)
# =========================================================
def get_server_status():
    return SERVER_HEALTH
import os
import json
from dotenv import load_dotenv

load_dotenv()

# =========================================================
# MODEL CONFIG
# =========================================================
# ollama | openai | ogx, default local ollama
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434")
MODEL_NAME = os.getenv("MODEL_NAME", "llama3.1")
#LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ogx")
#LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:8321/v1")
#MODEL_NAME = os.getenv("MODEL_NAME", "ollama/llama3.2:3b")
#MODEL_NAME="ollama/llama3.2:3b"
VECTOR_STORE_ID = os.getenv("VECTOR_STORE_ID", "vs_d8063d09-9c8e-485a-8770-a4af5630ab9f")

LLM_API_KEY = os.getenv("LLM_API_KEY", "dummy")

MAX_STEPS = int(os.getenv("MAX_STEPS", "9"))
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
SHOW_TOOL_TRACE = os.getenv("SHOW_TOOL_TRACE", "true").lower() == "true"

# =========================================================
# MCP TRANSPORT & REGISTRY (CONFIGMAP POWERED)
# =========================================================
MCP_SCHEME = os.getenv("MCP_SCHEME", "http")

# Fallback defaults used ONLY if the ConfigMap environment variable is completely missing
DEFAULT_SERVERS = [
    {
        "name": "Weather MCP Server",
        "url": f"{MCP_SCHEME}://localhost:8060/mcp",
        "transport": MCP_SCHEME,
        "description": "Weather services and historic climate lookups",
        "examples": [
            "Weather expected in Dubai today",
            "Weather expected in Dubai on 2026-06-29"
        ]
    },
    {
        "name": "HR MCP Server",
        "url": f"{MCP_SCHEME}://localhost:8000/mcp",
        "transport": MCP_SCHEME,
        "description": "HR services and employee operations",
        "examples": [
            "Remote Work Policy?",
            "Get basic profile for Osama Oransa",
            "What is the current leave balance for Sara Ali?"
        ]
    },
    {
        "name": "Orders MCP Server",
        "url": f"{MCP_SCHEME}://localhost:8001/mcp",
        "transport": MCP_SCHEME,
        "description": "Order processing and Kafka-based workflows",
        "examples": [
            "Show last 10 Kafka orders",
            "Show last 4 orders and compute the average amount"
        ]
    }
]

# Read the parsed string matrix out of the ConfigMap env
raw_mcp_servers = os.getenv("MCP_SERVERS_JSON")

if raw_mcp_servers:
    try:
        MCP_SERVERS = json.loads(raw_mcp_servers)
    except Exception as e:
        print(f"ERROR: Failed parsing MCP_SERVERS_JSON string. Falling back to defaults. Dev error: {e}")
        MCP_SERVERS = DEFAULT_SERVERS
else:
    print(f"ERROR: No MCP Servers configured, please set the environment variable: MCP_SERVERS_JSON!")
    MCP_SERVERS = DEFAULT_SERVERS

# =========================================================
# HELPER GETTERS
# =========================================================
def get_mcp_urls():
    return [s["url"] for s in MCP_SERVERS]

def get_mcp_by_name(name: str):
    return next((s for s in MCP_SERVERS if s["name"] == name), None)
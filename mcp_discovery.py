import asyncio

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from mcpconfig import MCP_SERVERS


discovered_servers = []

async def discover_server(server_config):

    result = {
        "name": server_config["name"],
        "url": server_config["url"],
        "transport": server_config["transport"],
        "description": server_config["description"],
        "examples": server_config.get("examples", []),  # <-- ADD THIS LINE RIGHT HERE!
        "status": "down",   # default = down
        "tools": []
    }

    try:
        async with streamablehttp_client(server_config["url"]) as (
            read_stream,
            write_stream,
            _
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                tools = await session.list_tools()

                result["status"] = "up"   # ONLY success = up

                result["tools"] = [
                    {
                        "name": tool.name,
                        "description": str(tool.description) if tool.description else ""
                    }
                    for tool in tools.tools
                ]

    except Exception as ex:
        result["status"] = "down"  # ALWAYS down on failure

    return result
    
async def discover_all_servers():

    tasks = [
        discover_server(server)
        for server in MCP_SERVERS
    ]

    return await asyncio.gather(*tasks)
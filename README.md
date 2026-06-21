# Deploy Custom MCP Client over OpenShift

This demo shows how to deploy custom MCP Client over OpenShift, the following is the solution components.

<img width="1536" height="1024" alt="MCP-client-architecture" src="https://github.com/user-attachments/assets/fe727a82-853f-4a47-a7dc-fda91ca88284" />


You need first to have list of available MCP Servers, if you don't have one, deploy the HR MCP server from here: https://github.com/osa-ora/ocp-ai-custom-mcp-demo


Construct the list of MCP Servers as following: 

```
DEFAULT_SERVERS = [
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
    }
]
```
Add it to the following ConfigMap, populate the Model information and any other configurations, then create that ConfigMap as following:

```
oc create configmap mcp-client-config \
  --from-literal=PORT=8080 \
  --from-literal=LLM_PROVIDER=openai \
  --from-literal=LLM_BASE_URL=http://maas.......opentlc.com/llm/qwen3-4b-instruct/v1 \
  --from-literal=LLM_API_KEY=..... \
  --from-literal=MODEL_NAME=qwen3-4b-instruct \
  --from-literal=MAX_STEPS=9 \
  --from-literal=DEBUG=true \
  --from-literal=SHOW_TOOL_TRACE=true \
  --from-literal=MCP_SCHEME=http \
  --from-literal=MCP_SERVERS_JSON='[{"name": "HR MCP Server", "url": "http://hr-mcp-server.hr-mcp.svc.cluster.local:8080/mcp", "transport": "http", "description": "HR services and employee operations", "examples": ["Remote Work Policy?", "Get basic profile for Osama Oransa", "What is the current leave balance for Sara Ali?"]}]' \
  -n hr-mcp
```

Deploy the application: 

```
oc new-app python:3.12-minimal-ubi10~https://github.com/osa-ora/ocp-ai-mcp-client-demo --name=ocp-ai-mcp-client-demo -n hr-mcp

oc set env deployment/ocp-ai-mcp-client-demo --from=configmap/mcp-client-config -n hr-mcp
oc rollout restart deployment/ocp-ai-mcp-client-demo -n hr-mcp

oc expose svc/ocp-ai-mcp-client-demo -n hr-mcp
```

Open the route and start interacting with the MCP client Chat Application.

<img width="1721" height="876" alt="Screenshot 2026-06-21 at 4 00 43 PM" src="https://github.com/user-attachments/assets/f6b4d357-4971-4260-afe7-31e8890214b9" />

Example requests (based on the HR MCP Server):

- Leave balance for Osama Oransa?
- Basic profile for Sara Ali
- Show my full profile for EMP001?
- Policy for remote work?
- leave requests for Osama Oransa
- Basic profile for EMP002


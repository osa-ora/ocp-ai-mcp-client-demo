# ocp-ai-mcp-client-demo
Demo to show how to deploy custom MCP Client over OpenShift

You need first to have list of available MCP Servers, if you don't have one, deploy the HR MCP server from here: https://github.com/osa-ora/ocp-ai-custom-mcp-demo

Construct the list of MCP Servers as following: 

```
MCP_SERVERS_JSON: |
    [
      {
        "name": "HR MCP Server",
        "url": "http://hr-mcp-server.hr-mcp.svc.cluster.local:8080/mcp",
        "transport": "http",
        "description": "HR services and employee operations"
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
  --from-literal=MCP_SERVERS_JSON='[{"name": "HR MCP Server", "url": "http://hr-mcp-server.hr-mcp.svc.cluster.local:8080/mcp", "transport": "http", "description": "HR services and employee operations"}]' \
  -n hr-mcp
```

Deploy the application: 

```
oc new-app python:3.12-minimal-ubi10~https://github.com/osa-ora/ocp-ai-mcp-client-demo --name=ocp-ai-mcp-client-demo -n hr-mcp

oc set env deployment/ocp-ai-mcp-client-demo --from=configmap/mcp-client-config -n hr-mcp
oc rollout restart deployment/ocp-ai-mcp-client-demo -n hr-mcp
```

Open the route and start interacting with the MCP client Chat Application.

<img width="1492" height="729" alt="Screenshot 2026-06-12 at 3 32 58 PM" src="https://github.com/user-attachments/assets/e92af57c-e7ed-4a83-8751-5322ebdcb710" />

Example requests (based on the HR MCP Server):

"leave balance for Osama Oransa?"
"basic profile for Sara Ali"
"Show my full profile for EMP001?"
"policy for remote work?"
"leave requests for Osama Oransa."
"basic profile for EMP002"


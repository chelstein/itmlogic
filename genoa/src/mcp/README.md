# Genoa sidecar MCP server

Exposes genoa's existing sidecar HTTP clients (`src/evidence/{fccamClient,voacapClient,nec/client,identity}.js`)
as MCP tools over stdio, so a Claude session (or any other MCP client)
can run a real FCCAM skywave calc, NEC2++ model, VOACAP advisory, or
identity resolve directly — without going through genoa's own
authenticated HTTP API.

This is a wrapper, not a new implementation. Every tool call goes
straight through the same client factory genoa's API itself uses, so
there is exactly one place that knows each sidecar's HTTP shape, auth
header and response envelope.

## Run

```bash
npm run mcp:sidecars
```

## Config

Same env vars genoa's API already reads:

| Var | Sidecar |
|---|---|
| `FCCAM_SIDECAR_URL`, `FCCAM_API_TOKEN` | FCCAM (§73.190(c) skywave) |
| `NEC_SIDECAR_URL` | NEC2++ (§73.62/§73.150 RTA, §1.1310 near-field) |
| `VOACAP_SIDECAR_URL`, `VOACAP_API_TOKEN` | VOACAP (HF advisory, never filing-controlling) |
| `IDENTITY_SIDECAR_URL` | Identity (RadioDNS/RDS/EAS-SAME adapter) |

A sidecar whose URL env var is unset reports its tools as
`available: false` rather than crashing the server — matching every
other client factory's "no baseUrl -> return null" convention in this
codebase.

## Tools

| Tool | Wraps |
|---|---|
| `sidecar_health` | health of all four, in one call |
| `fccam_skywave_field` | `fccamClient.fieldAtDistance()` |
| `fccam_skywave_distance` | `fccamClient.distanceToField()` |
| `fccam_nif_study` | `fccamClient.runNifStudy()` |
| `nec_run_model` | `necClient.run()` |
| `nec_run_am_array` | `necClient.runAmArray()` |
| `nec_optimize_pattern` | `necClient.optimizePattern()` |
| `voacap_run_path` | `voacapClient.runPath()` |
| `identity_resolve` | `identityClient.resolve()` |

## Connecting a Claude session

Add to the client's MCP config, e.g. `claude mcp add`:

```json
{
  "mcpServers": {
    "genoa-sidecars": {
      "command": "node",
      "args": ["src/mcp/sidecarServer.js"],
      "cwd": "/path/to/itmlogic/genoa",
      "env": {
        "FCCAM_SIDECAR_URL": "http://localhost:8090",
        "NEC_SIDECAR_URL": "http://localhost:8085",
        "VOACAP_SIDECAR_URL": "http://localhost:8086",
        "IDENTITY_SIDECAR_URL": "http://localhost:8083"
      }
    }
  }
}
```

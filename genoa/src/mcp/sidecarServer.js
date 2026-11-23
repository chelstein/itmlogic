// Genoa sidecar MCP server.
//
// Exposes the four HTTP sidecars Genoa already has well-tested client
// factories for (FCCAM §73.190(c) skywave, NEC2++ antenna modeling,
// VOACAP HF advisory, identity/RadioDNS) as MCP tools, over stdio.
//
// This is a thin wrapper, not a new implementation: every tool below
// calls straight into the existing src/evidence/*.js client factories —
// the same code genoa's own API uses — so there is exactly one place
// that knows how to talk to each sidecar's HTTP shape, auth header, and
// response envelope. A Claude session (or any other MCP client) gets
// ad-hoc access to run a real skywave/NEC/VOACAP/identity query without
// going through genoa's own authenticated HTTP API.
//
// Run: node src/mcp/sidecarServer.js
// Config: same env vars genoa's API already reads —
//   FCCAM_SIDECAR_URL / FCCAM_API_TOKEN
//   NEC_SIDECAR_URL
//   VOACAP_SIDECAR_URL / VOACAP_API_TOKEN
//   IDENTITY_SIDECAR_URL
// A sidecar whose URL env var is unset reports its tools as unavailable
// rather than failing the whole server — matching every other client
// factory's "no baseUrl -> return null" convention in this codebase.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { makeFccamClient }    from '../evidence/fccamClient.js';
import { makeVoacapClient }   from '../evidence/voacapClient.js';
import { makeNecClient }      from '../evidence/nec/client.js';
import { makeIdentityClient } from '../evidence/identity/index.js';

const fccam    = makeFccamClient();
const voacap   = makeVoacapClient();
const nec      = makeNecClient({ baseUrl: process.env.NEC_SIDECAR_URL || null });
const identity = makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL });

function unavailable(sidecarName, envVar){
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        available: false,
        error: `${sidecarName} sidecar not configured — set ${envVar} in this process's environment`
      })
    }],
    isError: true
  };
}

function ok(result){
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function errorResult(e){
  return {
    content: [{ type: 'text', text: JSON.stringify({ available: false, error: String(e?.message || e) }) }],
    isError: true
  };
}

const TOOLS = [
  {
    name: 'sidecar_health',
    description: 'Check reachability/health of every configured genoa sidecar (fccam, nec, voacap, identity) in one call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'fccam_skywave_field',
    description: '47 CFR §73.190(c) Wang-1985 FCCAM: filing-grade 50% (or 10%) skywave field strength at a given distance.',
    inputSchema: {
      type: 'object',
      required: ['erp_kw', 'freq_khz', 'distance_km', 'midpoint_lat'],
      properties: {
        erp_kw:       { type: 'number', description: 'ERP in kW, unattenuated' },
        freq_khz:     { type: 'integer', description: 'AM carrier in kHz, 10-kHz grid, 535-1705' },
        distance_km:  { type: 'number' },
        midpoint_lat: { type: 'number', description: 'Geographic latitude at the great-circle midpoint' },
        percent_time: { type: 'integer', enum: [10, 50], default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'fccam_skywave_distance',
    description: '47 CFR §73.190(c) Wang-1985 FCCAM inverse solve: distance at which skywave field decays to a target field strength (NIF radius).',
    inputSchema: {
      type: 'object',
      required: ['erp_kw', 'freq_khz', 'field_uv_m', 'midpoint_lat'],
      properties: {
        erp_kw:       { type: 'number' },
        freq_khz:     { type: 'integer' },
        field_uv_m:   { type: 'number', description: 'Target skywave field strength in uV/m' },
        midpoint_lat: { type: 'number' },
        percent_time: { type: 'integer', enum: [10, 50], default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'fccam_nif_study',
    description: 'Full §73.182 AM nighttime interference-free (NIF) contour study against one or more interferers, filing-grade via FCCAM.',
    inputSchema: {
      type: 'object',
      required: ['frequency_khz', 'subject'],
      properties: {
        frequency_khz: { type: 'integer' },
        subject: {
          type: 'object',
          required: ['lat', 'lon'],
          properties: {
            call: { type: 'string' }, facility_id: { type: 'string' },
            lat: { type: 'number' }, lon: { type: 'number' },
            power_kw: { type: 'number' }, rms_mv_m_1km: { type: 'number' },
            pattern_table: { type: 'array' }, mode: { type: 'string' }
          }
        },
        interferers:   { type: 'array', items: { type: 'object' } },
        azimuths_deg:  { type: 'array', items: { type: 'number' } },
        percent_time:  { type: 'integer', enum: [10, 50], default: 50 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'nec_run_model',
    description: 'Run an arbitrary NEC2++ wire-segment Method-of-Moments model (47 CFR §73.62/§73.150 RTA, §1.1310 near-field).',
    inputSchema: {
      type: 'object',
      required: ['model'],
      properties: { model: { type: 'object', description: 'See src/sidecars/nec/server.js header for the full schema (frequency_mhz, ground, wires[], excitations[], pattern, near_field).' } },
      additionalProperties: false
    }
  },
  {
    name: 'nec_run_am_array',
    description: 'Convenience: build a vertical-tower AM directional array from a high-level spec (frequency_khz + towers[]) and run it through NEC2++.',
    inputSchema: {
      type: 'object',
      required: ['spec'],
      properties: { spec: { type: 'object', description: '{ frequency_khz, towers: [{ tag, x_m, y_m, height_m, radius_m, drive: { amplitude, phase_deg } }], ground?, pattern? }' } },
      additionalProperties: false
    }
  },
  {
    name: 'nec_optimize_pattern',
    description: 'Coarse phase grid search for a tower array to hit a target bearing + suppression level.',
    inputSchema: {
      type: 'object',
      required: ['spec'],
      properties: { spec: { type: 'object', description: '{ base_model, target_bearing_deg, desired_suppression_db, phase_step_deg?, max_iterations? }' } },
      additionalProperties: false
    }
  },
  {
    name: 'voacap_run_path',
    description: 'HF ionospheric advisory (VOACAP) for a tx/rx path — screening-only context, never filing-controlling (advisory:true, filing_effect:"none").',
    inputSchema: {
      type: 'object',
      required: ['tx_lat', 'tx_lon', 'rx_lat', 'rx_lon', 'freq_mhz', 'month'],
      properties: {
        tx_lat: { type: 'number' }, tx_lon: { type: 'number' },
        rx_lat: { type: 'number' }, rx_lon: { type: 'number' },
        freq_mhz: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 11 },
        month: { type: 'integer', minimum: 1, maximum: 12 },
        ssn: { type: 'integer', default: 50 },
        power_kw: { type: 'number', default: 1.0 },
        required_snr_db: { type: 'number', default: 48.0 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'identity_resolve',
    description: 'Resolve station identity confirmations (RadioDNS/RDS/EAS-SAME/audio-fp) via the identity sidecar adapter.',
    inputSchema: {
      type: 'object',
      properties: {
        call: { type: 'string' }, facility_id: { type: 'string' },
        frequency: { type: 'number' }, frequency_unit: { type: 'string' },
        gcc: { type: 'string' }, pi: { type: 'string' }
      },
      additionalProperties: false
    }
  }
];

const server = new Server(
  { name: 'genoa-sidecars', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name){
      case 'sidecar_health': {
        const [fccamHealth, voacapHealth, necHealth, identityHealth] = await Promise.all([
          fccam    ? fccam.health()    : Promise.resolve(false),
          voacap   ? voacap.health()   : Promise.resolve(false),
          nec      ? nec.health()      : Promise.resolve(false),
          identity ? identity.health() : Promise.resolve(false)
        ]);
        return ok({
          fccam:    { configured: !!fccam,    healthy: fccamHealth },
          voacap:   { configured: !!voacap,   healthy: voacapHealth },
          nec:      { configured: !!nec,      healthy: necHealth },
          identity: { configured: !!identity, healthy: identityHealth }
        });
      }

      case 'fccam_skywave_field':
        if (!fccam) return unavailable('fccam', 'FCCAM_SIDECAR_URL');
        return ok(await fccam.fieldAtDistance(args));

      case 'fccam_skywave_distance':
        if (!fccam) return unavailable('fccam', 'FCCAM_SIDECAR_URL');
        return ok(await fccam.distanceToField(args));

      case 'fccam_nif_study':
        if (!fccam) return unavailable('fccam', 'FCCAM_SIDECAR_URL');
        return ok(await fccam.runNifStudy(args));

      case 'nec_run_model':
        if (!nec) return unavailable('nec', 'NEC_SIDECAR_URL');
        return ok(await nec.run(args.model));

      case 'nec_run_am_array':
        if (!nec) return unavailable('nec', 'NEC_SIDECAR_URL');
        return ok(await nec.runAmArray(args.spec));

      case 'nec_optimize_pattern':
        if (!nec) return unavailable('nec', 'NEC_SIDECAR_URL');
        return ok(await nec.optimizePattern(args.spec));

      case 'voacap_run_path':
        if (!voacap) return unavailable('voacap', 'VOACAP_SIDECAR_URL');
        return ok(await voacap.runPath(args));

      case 'identity_resolve':
        if (!identity) return unavailable('identity', 'IDENTITY_SIDECAR_URL');
        return ok(await identity.resolve(args));

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (e){
    return errorResult(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

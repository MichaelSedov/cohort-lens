#!/usr/bin/env node
// cohort-lens MCP server (stdio transport).
//
// Exposes four tools that wrap the BFF, plus a "metrics-glossary" resource so
// the LLM has grounding for cohort/pROAS/CPI terminology without needing every
// tool description to repeat it.
//
// Config comes from env:
//   COHORT_LENS_URL    — e.g. http://127.0.0.1:54321/functions/v1
//   COHORT_LENS_JWT    — a Supabase user JWT (see README quickstart)
//   COHORT_LENS_ORG_ID — the org uuid to scope the session to
//   MCP_MAX_ROWS       — response row cap (default 50)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodTypeAny } from "zod";
import { BffClient, BffError } from "./client.ts";
import * as getCohortPerformance from "./tools/get-cohort-performance.ts";
import * as comparePeriods from "./tools/compare-periods.ts";
import * as scoreCreatives from "./tools/score-creatives.ts";
import * as listCampaigns from "./tools/list-campaigns.ts";
import { GLOSSARY_MIME, GLOSSARY_TEXT, GLOSSARY_URI } from "./resources/glossary.ts";

type ToolMod = {
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  execute: (client: BffClient, input: unknown) => Promise<unknown>;
};

const TOOLS: Record<string, ToolMod> = {
  list_campaigns: listCampaigns,
  get_cohort_performance: getCohortPerformance,
  compare_periods: comparePeriods,
  score_creatives: scoreCreatives,
};

const MAX_ROWS = Number(process.env.MCP_MAX_ROWS ?? 50);

/** Convert a Zod schema object into MCP tool input JSON Schema. */
function toJsonSchema(shape: Record<string, ZodTypeAny>): unknown {
  // z.object → z.toJSONSchema exists in zod v4; we use it and strip $schema.
  const s = z.toJSONSchema(z.object(shape));
  if (typeof s === "object" && s !== null && "$schema" in s) delete (s as Record<string, unknown>).$schema;
  return s;
}

/**
 * Truncate array-shaped BFF responses to MAX_ROWS and add explicit truncation
 * marker. Never silently drops rows — the model sees "truncated: true" and
 * the untruncated count.
 */
function truncateRows<T extends object>(body: T): T & { truncated?: boolean; totalRows?: number } {
  const rowsKey = ["rows", "items"].find(
    (k) => Array.isArray((body as Record<string, unknown>)[k]),
  );
  if (!rowsKey) return body;
  const rows = (body as Record<string, unknown>)[rowsKey] as unknown[];
  if (rows.length <= MAX_ROWS) return body;
  return {
    ...body,
    [rowsKey]: rows.slice(0, MAX_ROWS),
    truncated: true,
    totalRows: rows.length,
  };
}

async function main() {
  const client = new BffClient();
  const server = new Server(
    { name: "cohort-lens", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(TOOLS).map(([name, mod]) => ({
      name,
      description: mod.description,
      inputSchema: toJsonSchema(mod.inputSchema) as { type: "object" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const mod = TOOLS[req.params.name];
    if (!mod) throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${req.params.name}`);
    const parsed = z.object(mod.inputSchema).safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `invalid arguments for ${req.params.name}: ${parsed.error.message}`,
      );
    }
    try {
      const raw = await mod.execute(client, parsed.data);
      const body = truncateRows(raw as object);
      return {
        content: [{ type: "text", text: JSON.stringify(body) }],
      };
    } catch (err) {
      if (err instanceof BffError) {
        // Surface the BFF's error code intact — the model sees "org_forbidden"
        // rather than a generic "tool failed".
        throw new McpError(
          err.status === 400 ? ErrorCode.InvalidParams : ErrorCode.InternalError,
          `${err.code}: ${err.message}`,
        );
      }
      throw err;
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: GLOSSARY_URI,
        name: "cohort-lens metrics glossary",
        description: "Definitions of cohort, day_index, ROAS, pROAS, CPI, retention proxy.",
        mimeType: GLOSSARY_MIME,
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== GLOSSARY_URI) {
      throw new McpError(ErrorCode.InvalidRequest, `unknown resource: ${req.params.uri}`);
    }
    return { contents: [{ uri: GLOSSARY_URI, mimeType: GLOSSARY_MIME, text: GLOSSARY_TEXT }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio server runs until the transport closes.
}

main().catch((err) => {
  // stderr only; stdout is reserved for the MCP protocol.
  console.error("[cohort-lens mcp] fatal:", err);
  process.exit(1);
});

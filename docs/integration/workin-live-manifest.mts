// Pinned manifest for a workin-live report: what exactly was measured. Used by workin-live-eval.mts.
// Hashes only; no secret values (token, keys, DB passwords) are read into the manifest.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type Row = Record<string, unknown>;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const fileHash = (file: string) => sha256(readFileSync(file));

/** One hash over every file under `dir` (sorted relative paths + contents); the engine is not a git repo. */
export function treeHash(dir: string): { files: number; sha256: string } {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(dir);
  const hash = createHash('sha256');
  for (const file of files) hash.update(path.relative(dir, file).replace(/\\/g, '/')).update('\0').update(readFileSync(file)).update('\0');
  return { files: files.length, sha256: hash.digest('hex') };
}

/** Commit and dirty state of a sibling service repo; `dirty` lists changed paths so a run on WIP code is visible. */
export function repoState(dir: string): Row {
  const raw = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const git = (...args: string[]) => raw(...args).trim();
  try {
    // Porcelain lines are "XY path"; X may be a space, so the output must not be trimmed before slicing.
    const changed = raw('status', '--porcelain', '--untracked-files=no').split('\n').filter((line) => line.trim() !== '').map((line) => line.slice(3));
    return { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), dirty: changed };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
  }
}

/**
 * X04: input tokens the tool catalog adds to every request, measured with the provider's token counter
 * (same request with and without tools). Needs ANTHROPIC_API_KEY and VIPER_MODEL; otherwise NOT_MEASURED.
 */
async function catalogTokens(definitions: Row[]): Promise<Row> {
  const apiKey = process.env.ANTHROPIC_API_KEY; const model = process.env.VIPER_MODEL ?? 'claude-opus-5-5';
  if (!apiKey || definitions.length === 0) return { status: 'NOT_MEASURED' };
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const messages = [{ role: 'user' as const, content: 'x' }];
    const base = await client.messages.countTokens({ model, messages });
    const withTools = await client.messages.countTokens({ model, messages, tools: definitions as never });
    return { status: 'measured', model, catalogTokens: withTools.input_tokens - base.input_tokens };
  } catch (error) {
    return { status: 'ERROR', error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** tools/list through the gateway with the same token: names, annotations and a schema hash per tool. */
export async function toolCatalog(gatewayUrl: string, token: string): Promise<Row> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'workin-live-manifest', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gatewayUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const tools: Row[] = [];
    const definitions: Row[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor === undefined ? {} : { cursor });
      for (const tool of page.tools) {
        // What the Anthropic adapter sends per tool (alias, description, input schema) for the X04 catalog size.
        const definition = { name: `workin__${tool.name}`, ...(tool.description === undefined ? {} : { description: tool.description }), input_schema: tool.inputSchema };
        definitions.push(definition);
        tools.push({ name: tool.name, readOnly: tool.annotations?.readOnlyHint ?? null, bytes: Buffer.byteLength(JSON.stringify(definition)),
          sha256: sha256(JSON.stringify({ description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null })) });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    tools.sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
    const schemaBytes = tools.reduce((sum, tool) => sum + Number(tool.bytes), 0);
    return { count: tools.length, schemaBytes, sha256: sha256(JSON.stringify(tools)), tools, tokens: await catalogTokens(definitions) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ManifestInput {
  readonly root: string; readonly gatewayUrl: string; readonly token: string; readonly hostInstruction: string;
  readonly model: Row; readonly trials: number; readonly caseIds: readonly string[];
}

export async function buildManifest(input: ManifestInput): Promise<Row> {
  const at = (file: string) => path.join(input.root, file);
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8')) as Row;
  const sdk = JSON.parse(readFileSync(at('node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')) as Row;
  const anthropic = (() => { try { return (JSON.parse(readFileSync(at('node_modules/@anthropic-ai/sdk/package.json'), 'utf8')) as Row).version; } catch { return null; } })();
  const services = path.resolve(input.root, '..');
  return {
    createdAt: new Date().toISOString(),
    engine: { version: pkg.version, src: treeHash(at('src')), node: process.version, mcpSdk: sdk.version, anthropicSdk: anthropic },
    model: input.model,
    hostInstruction: { text: input.hostInstruction, sha256: sha256(input.hostInstruction) },
    dataset: { file: 'evals/datasets/workin-live/cases.json', sha256: fileHash(at('evals/datasets/workin-live/cases.json')), cases: input.caseIds, trials: input.trials },
    runner: { sha256: fileHash(at('docs/integration/workin-live-eval.mts')) },
    data: { dummyManifestSha256: fileHash(at('docs/integration/workin-dummy-manifest.json')) },
    services: { gateway_v3: repoState(path.join(services, 'gateway_v3')), service_attendance: repoState(path.join(services, 'service_attendance')),
      service_employees: repoState(path.join(services, 'service_employees')) },
    gateway: { url: input.gatewayUrl, catalog: await toolCatalog(input.gatewayUrl, input.token) },
  };
}

import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { parseJsonObject } from '../../../contracts/messages/json.js';
import type { McpPage, McpPromptDefinition, McpResourceDefinition } from '../../../contracts/mcp/catalog.js';
import type { McpPromptResult, McpResourceContents } from '../../../contracts/mcp/content.js';
import type { McpPromptGetRequest } from '../../../contracts/mcp/gateway.js';
import { parseMcpContent, parseMcpResourceContents } from '../../../contracts/mcp/parse-content.js';
import { NotAdvertisedError } from './failures.js';
import type { McpSession } from './session.js';

/**
 * Application-controlled resource/prompt reads (P05-03 adds per-user credentials and policy).
 * Values pass through the contract parsers; unknown wire fields and `_meta` are dropped.
 */
function optionalText(source: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => (typeof source[key] === 'string' ? [[key, source[key]]] : [])));
}

function page<Item>(items: readonly Item[], nextCursor: string | undefined): McpPage<Item> {
  return Object.freeze(nextCursor === undefined ? { items: Object.freeze([...items]) } : { items: Object.freeze([...items]), nextCursor });
}

export async function listResources(session: McpSession, cursor: string | undefined, options: RequestOptions): Promise<McpPage<McpResourceDefinition>> {
  const result = await session.client.listResources(cursor === undefined ? {} : { cursor }, options);
  const items = result.resources.map(resource => Object.freeze({
    uri: resource.uri, name: resource.name, ...optionalText(resource, ['title', 'description', 'mimeType']),
  }));
  return page(items, result.nextCursor);
}

const MAX_LIST_PAGES = 20;

/** Walks the advertised list; reads are limited to what the server itself offered. */
async function advertised(list: (cursor: string | undefined) => Promise<McpPage<{ readonly name: string; readonly uri?: string }>>,
  matches: (item: { readonly name: string; readonly uri?: string }) => boolean): Promise<boolean> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await list(cursor);
    if (result.items.some(matches)) return true;
    if (result.nextCursor === undefined) return false;
    cursor = result.nextCursor;
  }
  return false;
}

export async function readResource(session: McpSession, uri: string, options: RequestOptions, authorize?: () => Promise<void>): Promise<readonly McpResourceContents[]> {
  if (!(await advertised(cursor => listResources(session, cursor, options), item => item.uri === uri))) throw new NotAdvertisedError();
  await authorize?.();
  const result = await session.client.readResource({ uri }, options).catch((error: unknown) => {
    if (error instanceof McpError && error.code === -32002) throw new NotAdvertisedError();
    throw error;
  });
  return Object.freeze(result.contents.map(content => parseMcpResourceContents({
    uri: content.uri, ...optionalText(content, ['mimeType', 'text', 'blob']),
  })));
}

export async function listPrompts(session: McpSession, cursor: string | undefined, options: RequestOptions): Promise<McpPage<McpPromptDefinition>> {
  const result = await session.client.listPrompts(cursor === undefined ? {} : { cursor }, options);
  const items = result.prompts.map(prompt => Object.freeze({
    name: prompt.name, ...optionalText(prompt, ['title', 'description']),
    ...(prompt.arguments === undefined ? {} : {
      arguments: Object.freeze(prompt.arguments.map(argument => Object.freeze({
        name: argument.name, ...optionalText(argument, ['description']),
        ...(argument.required === undefined ? {} : { required: argument.required }),
      }))),
    }),
  }));
  return page(items, result.nextCursor);
}

export async function getPrompt(session: McpSession, request: McpPromptGetRequest, options: RequestOptions, authorize?: () => Promise<void>): Promise<McpPromptResult> {
  if (!(await advertised(cursor => listPrompts(session, cursor, options), item => item.name === request.name))) throw new NotAdvertisedError();
  await authorize?.();
  const result = await session.client.getPrompt({
    name: request.name, ...(request.arguments === undefined ? {} : { arguments: { ...request.arguments } }),
  }, options);
  const messages = result.messages.map(message => Object.freeze({
    role: message.role,
    content: Object.freeze([parseMcpContent(parseJsonObject(JSON.parse(JSON.stringify(message.content))))]),
  }));
  return Object.freeze({ ...optionalText(result, ['description']), messages: Object.freeze(messages) });
}

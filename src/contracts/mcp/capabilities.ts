/** Advertised server features, not authorization to enable optional host behaviors. */
export interface McpCapabilities {
  readonly protocolVersion: string;
  readonly tools?: { readonly listChanged?: boolean };
  readonly resources?: { readonly listChanged?: boolean; readonly subscribe?: boolean };
  readonly prompts?: { readonly listChanged?: boolean };
}

export type McpFeature = 'tools' | 'resources' | 'prompts';

export function supportsMcpFeature(capabilities: McpCapabilities, feature: McpFeature): boolean {
  return capabilities[feature] !== undefined;
}

export function assertMcpFeature(capabilities: McpCapabilities, feature: McpFeature): void {
  if (!supportsMcpFeature(capabilities, feature)) throw new Error(`Unsupported MCP feature: ${feature}`);
}

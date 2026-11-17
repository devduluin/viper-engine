export type McpResourceContents =
  | { readonly uri: string; readonly mimeType?: string; readonly text: string }
  | { readonly uri: string; readonly mimeType?: string; readonly blob: string };

/** Normalized baseline content; no SDK/wire class or automatic URI fetching. */
export type McpContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image' | 'audio'; readonly mimeType: string; readonly data: string }
  | {
    readonly type: 'resource_link'; readonly uri: string; readonly name: string;
    readonly title?: string; readonly description?: string; readonly mimeType?: string;
  }
  | { readonly type: 'resource'; readonly resource: McpResourceContents };

export interface McpPromptResult {
  readonly description?: string;
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: readonly McpContent[];
  }[];
}

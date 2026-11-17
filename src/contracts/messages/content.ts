import type { JsonValue } from './json.js';

export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

export interface InlineMediaSource {
  readonly kind: 'inline';
  readonly mediaType: string;
  readonly encoding: 'base64';
  readonly data: string;
}

export interface ReferenceMediaSource {
  readonly kind: 'reference';
  readonly mediaType: string;
  readonly uri: string;
}

export type MediaSource = InlineMediaSource | ReferenceMediaSource;

export interface ImageContent {
  readonly type: 'image';
  readonly source: MediaSource;
}

export interface AudioContent {
  readonly type: 'audio';
  readonly source: MediaSource;
}

export interface JsonContent {
  readonly type: 'json';
  readonly data: JsonValue;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | JsonContent;

import { isDeepStrictEqual } from 'node:util';
import { fixtureValidators, assertSchema } from '../lib/schema.mjs';

export class FakeMcp {
  constructor(root, catalog) {
    this.catalog = structuredClone(catalog);
    this.validators = fixtureValidators(root);
    this.calls = [];
  }

  request(method, params = {}) {
    this.calls.push(structuredClone({ method, params }));
    switch (method) {
      case 'tools/list': return { tools: this.catalog.tools.map(({ responses, ...definition }) => definition) };
      case 'tools/call': return this.callTool(params);
      case 'resources/list': return { resources: this.catalog.resources.map(({ text, ...metadata }) => metadata) };
      case 'resources/read': return this.readResource(params.uri);
      case 'prompts/list': return { prompts: this.catalog.prompts.map(({ fixtures, ...metadata }) => metadata) };
      case 'prompts/get': return this.getPrompt(params);
      default: throw new Error(`Unsupported fixture method ${method}`);
    }
  }

  callTool(params) {
    const tool = this.catalog.tools.find(item => item.name === params.name);
    if (!tool) throw new Error('Unknown fixture tool');
    assertSchema(this.validators.compile(tool.inputSchema), params.arguments, 'tool arguments');
    const response = tool.responses.find(item => isDeepStrictEqual(item.arguments, params.arguments));
    if (!response) throw new Error('No canned response for these fixture arguments');
    return structuredClone(response.result);
  }

  readResource(uri) {
    const resource = this.catalog.resources.find(item => item.uri === uri);
    if (!resource) throw new Error('Unknown fixture resource');
    return { contents: [{ uri, mimeType: resource.mimeType, text: resource.text }] };
  }

  getPrompt(params) {
    const prompt = this.catalog.prompts.find(item => item.name === params.name);
    const response = prompt?.fixtures.find(item => isDeepStrictEqual(item.arguments, params.arguments));
    if (!response) throw new Error('Unknown fixture prompt or arguments');
    return structuredClone(response.result);
  }
}

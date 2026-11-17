import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';
import { importReferences } from './ast.mjs';
import { isInside, relativePath } from './files.mjs';

const allowed = {
  contracts: ['contracts'], shared: ['shared'], agent: ['contracts', 'shared', 'agent'],
  application: ['contracts', 'shared', 'agent', 'application'],
  adapters: ['contracts', 'shared', 'adapters'],
  entrypoints: ['contracts', 'application', 'entrypoints'],
  bootstrap: ['contracts', 'shared', 'agent', 'application', 'adapters', 'entrypoints', 'bootstrap'],
  public: ['bootstrap', 'contracts'],
};
const infrastructure = new Set(['adapters', 'entrypoints', 'bootstrap']);
const safeSharedBuiltins = new Set(['node:crypto', 'node:buffer', 'node:util', 'node:timers/promises']);

function layerOf(relative) {
  if (relative === 'src/index.ts') return 'public';
  return relative.split('/')[1];
}

function projectOptions(root) {
  const filename = path.join(root, 'tsconfig.json');
  const defaults = { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext, allowJs: true };
  if (!fs.existsSync(filename)) return defaults;
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  if (config.error) throw new Error('Invalid tsconfig.json');
  return { ...defaults, ...ts.parseJsonConfigFileContent(config.config, ts.sys, root).options };
}

function externalAllowed(layer, reference) {
  if (infrastructure.has(layer)) return true;
  if (reference.typeOnly && isBuiltin(reference.specifier)) return true;
  return layer === 'shared' && safeSharedBuiltins.has(reference.specifier);
}

function familyOf(relative) {
  return relative.split('/').slice(0, 3).join('/');
}

function inspectReference(root, filename, reference, options) {
  if (!reference.specifier) return { code: 'DYNAMIC_IMPORT', message: 'Module paths must be static literals' };
  const relative = relativePath(root, filename);
  const layer = layerOf(relative);
  const specifier = reference.specifier;
  const resolved = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule;
  if (!resolved && !isBuiltin(specifier)) return { code: 'UNRESOLVED_IMPORT', message: `Cannot resolve ${specifier}` };
  if (isBuiltin(specifier) || resolved?.isExternalLibraryImport) {
    return externalAllowed(layer, reference) ? {} : { code: 'EXTERNAL_IMPORT', message: `${layer} cannot import ${specifier}` };
  }
  return inspectLocalTarget(root, filename, resolved.resolvedFileName, layer);
}

function inspectLocalTarget(root, filename, resolvedFilename, layer) {
  const relative = relativePath(root, filename);
  const target = fs.realpathSync(resolvedFilename);
  if (!isInside(root, target)) return { code: 'OUTSIDE_IMPORT', message: 'Imports outside this project are forbidden' };
  const targetRelative = relativePath(root, target);
  if (!targetRelative.startsWith('src/')) return { code: 'NON_SOURCE_IMPORT', message: 'Production source cannot import tests or tooling' };
  const targetLayer = layerOf(targetRelative);
  if (!allowed[layer]?.includes(targetLayer)) return { code: 'LAYER_IMPORT', message: `${layer} cannot import ${targetLayer}` };
  if (layer === 'adapters' && targetLayer === 'adapters' && familyOf(relative) !== familyOf(targetRelative)) {
    return { code: 'ADAPTER_COUPLING', message: 'Compose different adapters through ports in bootstrap' };
  }
  return { target };
}

export function dependencyDiagnostics(root, sources) {
  const diagnostics = [];
  const graph = new Map();
  const options = projectOptions(root);
  for (const [filename, source] of sources) {
    if (!relativePath(root, filename).startsWith('src/')) continue;
    const layer = layerOf(relativePath(root, filename));
    if (!allowed[layer]) diagnostics.push({ file: filename, line: 1, code: 'UNKNOWN_LAYER', message: `Unknown source layer ${layer}` });
    const edges = [];
    for (const reference of importReferences(source)) {
      const result = inspectReference(root, filename, reference, options);
      if (result.code) diagnostics.push({ file: filename, line: reference.line, ...result });
      if (result.target) edges.push(result.target);
    }
    graph.set(filename, edges);
  }
  return [...diagnostics, ...cycleDiagnostics(graph)];
}

function cycleDiagnostics(graph) {
  const diagnostics = [];
  const done = new Set();
  const active = [];
  const visit = filename => {
    if (active.includes(filename)) {
      diagnostics.push({ file: filename, line: 1, code: 'DEPENDENCY_CYCLE', message: [...active.slice(active.indexOf(filename)), filename].join(' -> ') });
      return;
    }
    if (done.has(filename)) return;
    active.push(filename);
    for (const target of graph.get(filename) ?? []) visit(target);
    active.pop();
    done.add(filename);
  };
  for (const filename of graph.keys()) visit(filename);
  return diagnostics;
}

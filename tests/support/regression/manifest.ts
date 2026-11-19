import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { sourceHashes } from '../evaluation/snapshot.js';
import { engineCases } from './cases.js';

function installedVersions(wanted: Readonly<Record<string, string>>) {
  return Object.fromEntries(Object.entries(wanted).map(([name, version]) => {
    const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version: string };
    if (installed.version !== version) throw new Error(`Installed dependency differs from pin: ${name}`);
    return [name, installed.version];
  }));
}

/** Commit and uncommitted paths when the tree is a git repo; source hashes stay the authority. */
export function gitIdentity(): { readonly commit: string; readonly dirty: readonly string[] } | { readonly unavailable: string } {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dirty = git('status', '--porcelain').split('\n').filter(line => line.trim() !== '').map(line => line.slice(3)).sort();
    return { commit: git('rev-parse', 'HEAD').trim(), dirty };
  } catch {
    return { unavailable: 'not a git repository or git missing' };
  }
}

export function regressionSourceHashes() {
  return sourceHashes('.', ['src', 'tests', 'scripts', 'examples', 'evals/fixtures', 'evals/schemas', 'evals/lib', 'evals/support'],
    ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'evals/rubric.md']);
}
export function regressionManifest(mode: 'offline' | 'postgres', hashes: Readonly<Record<string, string>>) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  return { schemaVersion: 1, task: 'P08-01', datasetVersion: 'engine-regression-v1', mode,
    codeIdentity: 'actual-working-tree-sha256', git: gitIdentity(), sourceHashes: hashes,
    environment: { node: process.version, platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model,
      testConcurrency: 4, engineTrialConcurrency: 1 }, dependencies: installedVersions(pkg.dependencies), devDependencies: installedVersions(pkg.devDependencies),
    cases: engineCases(), split: 'synthetic-development-regressions-no-holdout-or-generalization-claim',
    instructions: 'No additional system instructions, recall or optional planning; explicit synthetic task input.',
    scope: 'synthetic actor-a/app-a; other actor and tenant access must return404',
    usageProvenance: 'Scripted SDK usage counters or unavailable; not real provider billing',
    cold: 'First delivery on a fresh engine/SDK/MCP session; DB migration/host setup excluded from trial clock',
    warm: 'Second independent conversation/run on the same engine/SDK/MCP catalog; business effect counters reset',
    latency: 'Local loopback HTTP+PostgreSQL+MCP+scripted SDK; includes automatic fixture approval/input, excludes grading and observer replay',
    exclusions: ['Live model semantic quality and billed cost NOT_MEASURED', 'V4/Hermes NOT_MEASURED',
      'OS/process cold start and real provider/cache/network latency NOT_MEASURED', 'No 120-task comparison dataset/holdout claim',
      ...(mode === 'offline' ? ['PostgreSQL/cold-warm engine trials NOT_RUN; choose eval:regression with explicit test DB'] : [])] };
}

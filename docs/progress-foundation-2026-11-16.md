# Foundation evidence archive

Moved intact from progress.md during P07-01 documentation maintenance. Historical P00 evidence;
current task status/validation remains in [progress](progress.md).

## P00 delivered artifacts

- Package/lockfile, strict compiler configs, injected validated foundation config, public export.
- AST function/complexity/file/layer/cycle gates dengan positive/negative fixtures.
- Documentation/link/DAG/checklist validator dan honest nonempty test runners.
- JSON Schemas, 9 scenario definitions, fake MCP tools/resources/prompts, rubric dan manifest.
- Workflow install/check/build Windows/Ubuntu; hosted CI belum dijalankan dari workspace ini.
- Parallel ownership/handoff guide. P01/P02 code belum dimulai saat P00 ditutup.

## Validation evidence

- `npm.cmd ci --offline --ignore-scripts --no-audit --cache D:\Development\.npm-cache`: PASS, 13 packages.
- Final `npm.cmd run check`: PASS, 24 unit + 9 contract tests = 33 passed, zero failures/skips.
- Final `npm.cmd run build`: PASS.
- Compiled foundation export smoke: PASS.
- Typecheck/lint/architecture/docs: zero violations, including strict JS source compilation.
- Negative tests reject oversized/complex functions, forbidden imports/cycles/aliases, symlinks,
  bad fixtures, dataset drift, false baseline status, and invalid task completion order.
- Fixture validator: 9 definitions; 3 tools, 1 resource, 1 prompt; benchmark remains NOT MEASURED.
- No live model/MCP/DB calls; docs no longer require sibling source files in standalone CI.

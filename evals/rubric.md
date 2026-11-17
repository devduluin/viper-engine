# Foundation fixture rubric v1

P00 specifies inputs, canned model responses and expected behavior. It does not execute an
agent, score a model or measure V4/Hermes. Fixture format is a test-data format, not the final
P01 ModelGateway contract. P03 can translate it into the agreed contract.

## Scenario assertions

| ID | Required future engine outcome |
| --- | --- |
| VE-001 | Final greeting without MCP dispatch |
| VE-002 | Exact item lookup before reporting stock |
| VE-003 | Second call arguments use stock from the first result; final sum correct |
| VE-004 | Ask for missing item ID without guessing or dispatching |
| VE-005 | MCP isError preserved and reported honestly |
| VE-006 | Read discovered resource through application-controlled context |
| VE-007 | Load user/application-selected prompt without granting permissions |
| VE-008 | Proposed write waits for approval; no actual save before permit |
| VE-009 | Repetition policy stops additional lookup dispatch |

`expected.toolNames` is the actual dispatch order expected from the future runtime, not a
list of every model proposal. Waiting-for-approval may have a tool proposal and zero dispatches.
Context requests are application-controlled fixture setup, not model-granted capabilities.

## Current validation

`npm run eval:validate` checks JSON Schemas, reference integrity, unique IDs and pinned dataset
hashes. Contract tests exercise fake MCP tools/resources/prompts and schema rejection. No network,
credentials, OAuth, subprocess MCP or production database is involved.

`FakeMcp` is a canned in-process fixture service, not a compliant wire MCP server/client.
Calls are recorded for future assertions; result data is cloned to avoid cross-test mutation.
Unknown methods/arguments fail explicitly rather than inventing results.

## Baseline manifest

`evals/manifests/foundation.json` records dataset hashes, budgets and a historical P00 source
snapshot. All engines and model selection remain not measured/null. Source snapshot hashes
describe the capture and do not freeze future implementation files. Dataset hash drift fails
validation until explicitly reviewed and regenerated with `npm run eval:manifest`.

Do not regenerate a baseline merely to hide a failing test. A revised dataset is reviewed by
the integration owner; multi-agent workers do not overwrite this manifest independently.
Future actual benchmark reports append versioned evidence and never reinterpret fixture validation
as completion rate. The larger evaluation design remains in [evaluation plan](../docs/evaluation-plan.md).

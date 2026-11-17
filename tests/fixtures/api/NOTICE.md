# OpenAPI fixture provenance

The unchanged OpenAPI 3.1 structural schema is from the OpenAPI Initiative:
[official schema](https://spec.openapis.org/oas/3.1/schema/2025-11-23).
Retrieved 16 November 2026. Local file: `openapi-3.1-2025-11-23.json`.
SHA-256: `1b8ccc6e34234b17536f2dd0eb3597142a32bd108438cd42471a5fca4c1a07ef`.

Upstream [license](https://github.com/OAI/spec.openapis.org/blob/main/LICENSE): Apache-2.0,
included verbatim as [OPENAPI-LICENSE.txt](OPENAPI-LICENSE.txt). This attribution applies to
the external fixture, not a new licensing declaration for Viper Engine.

The official schema explicitly excludes Schema Object validation. Tests separately compile
every Viper payload schema with strict Ajv 2020-12 and exercise valid/invalid fixtures.
Ajv 8.17.1 incorrectly resolves a non-root dynamic-anchor fallback in this structural schema.
Only the in-memory validator copy replaces four `#meta` dynamic references with their fixed
`#/$defs/schema` fallback. No external dynamic override is used; the pinned bytes stay unchanged.
Format annotations in the official structural schema are not validated. Viper wire fields use
explicit bounded patterns/ranges, and additional operation/auth/reference checks are tested.

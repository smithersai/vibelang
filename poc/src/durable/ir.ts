/**
 * The durable IR, kept as one import path while it is two files.
 *
 * `value.ts` holds the value-expression language — canonical JSON, digests,
 * type descriptors, schemas, policies, and the deployment/worker wire shapes.
 * `plan-ir.ts` holds the Plan node graph built on top of it. The split is a
 * pure move: every name this module exported before it still exports from
 * here, with the same identity, so no importer had to change.
 */
export * from "./value.ts"
export * from "./plan-ir.ts"

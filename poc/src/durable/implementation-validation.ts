/**
 * Integrity validation for serialized Action implementation contracts.
 * These checks never grant compiler provenance or callback authority. The
 * private compiler WeakMaps and their only writer remain in implementation-contract.ts.
 */
import type { ProjectDiagnostic } from "../language/model.ts"
import {
  assertJson, canonicalJson, deepFreeze, digest,
  type ActionDescriptor, type ActionImplementationContract, type DurableTypeDescriptor
} from "./value.ts"
import { validateActionContractDescriptor } from "./schema-runtime.ts"

/** @internal Shared format identity, not a provenance token. */
export const COMPILER_IDENTITY = "vibelang-action-implementation-v2" as const

export class ActionImplementationContractError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly ProjectDiagnostic[] = []
  ) {
    super(message)
    this.name = "ActionImplementationContractError"
  }
}

/** @internal Shared identity-field validation. */
export const nonEmpty = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ActionImplementationContractError(`${path} must be a non-empty string`)
  }
  return value
}

const digestValue = (value: unknown, path: string): string => {
  const candidate = nonEmpty(value, path)
  if (!/^[0-9a-f]{64}$/.test(candidate)) {
    throw new ActionImplementationContractError(`${path} must be a lowercase SHA-256 digest`)
  }
  return candidate
}

const sortedUniqueStrings = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ActionImplementationContractError(`${path} must be an array of non-empty strings`)
  }
  const expected = [...new Set(value)].sort()
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new ActionImplementationContractError(`${path} must be sorted and unique`)
  }
  return value as readonly string[]
}

/** Validate serialized compiler evidence without granting it in-process trust. */
export const validateActionImplementationContract = (value: unknown): ActionImplementationContract => {
  let snapshot: ReturnType<typeof assertJson>
  try {
    snapshot = assertJson(value, "Action implementation contract")
  } catch (error) {
    throw new ActionImplementationContractError(error instanceof Error ? error.message : String(error))
  }
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new ActionImplementationContractError("Action implementation contract must be an object")
  }
  const record = snapshot as Record<string, unknown>
  const expectedKeys = [
    "actionContractDigest", "actionErrorSchemaDigest", "actionId", "actionVersion", "checkedExportDigest",
    "compilerIdentity", "digest", "entryFile", "exportName", "failureSchemaDigest", "formatVersion",
    "implementationId", "implementationVersion", "panic", "projectDigest", "requirements", "source",
    "typedFailures"
  ]
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(expectedKeys)) {
    throw new ActionImplementationContractError("Action implementation contract has unknown or missing fields")
  }
  if (record.formatVersion !== 2 || record.source !== "compiler-derived" || record.compilerIdentity !== COMPILER_IDENTITY) {
    throw new ActionImplementationContractError("Action implementation contract has an unsupported compiler format")
  }
  nonEmpty(record.implementationId, "implementationId")
  nonEmpty(record.implementationVersion, "implementationVersion")
  nonEmpty(record.actionId, "actionId")
  if (!Number.isSafeInteger(record.actionVersion) || (record.actionVersion as number) < 1) {
    throw new ActionImplementationContractError("actionVersion must be a positive safe integer")
  }
  digestValue(record.actionContractDigest, "actionContractDigest")
  digestValue(record.actionErrorSchemaDigest, "actionErrorSchemaDigest")
  nonEmpty(record.entryFile, "entryFile")
  nonEmpty(record.exportName, "exportName")
  digestValue(record.projectDigest, "projectDigest")
  digestValue(record.checkedExportDigest, "checkedExportDigest")
  sortedUniqueStrings(record.requirements, "requirements")
  sortedUniqueStrings(record.typedFailures, "typedFailures")
  if (typeof record.panic !== "boolean") throw new ActionImplementationContractError("panic must be boolean")
  if (record.failureSchemaDigest !== null) digestValue(record.failureSchemaDigest, "failureSchemaDigest")
  const claimed = digestValue(record.digest, "digest")
  const { digest: _claimed, ...semantic } = record
  if (digest(semantic) !== claimed) {
    throw new ActionImplementationContractError("Action implementation contract digest mismatch")
  }
  return deepFreeze(record as unknown as ActionImplementationContract)
}

const actionTypedFailureNames = (descriptor: ActionDescriptor): readonly string[] => {
  if (descriptor.errorSchema.shape !== "structural") return []
  const names: string[] = []
  const visit = (value: DurableTypeDescriptor): void => {
    if (value.kind === "never") return
    if (value.kind === "error") {
      names.push(value.name)
      return
    }
    if (value.kind === "union") {
      for (const variant of value.variants) visit(variant)
      return
    }
    throw new ActionImplementationContractError(
      `Action ${descriptor.id} error schema is not a nominal Error or Error union`
    )
  }
  visit(descriptor.errorSchema.descriptor)
  const sorted = [...new Set(names)].sort()
  if (sorted.includes("Panic")) {
    throw new ActionImplementationContractError(
      `Action ${descriptor.id} uses reserved defect name Panic as a typed Error`
    )
  }
  return sorted
}

/**
 * Recheck serializable implementation evidence against the exact Action at
 * every provider/deployment boundary. This compares compiler-derived nominal
 * schema identity, not erased TypeScript names or runtime callback text.
 */
export const assertActionImplementationContractMatchesAction = (
  rawContract: ActionImplementationContract,
  rawAction: ActionDescriptor
): void => {
  const contract = validateActionImplementationContract(rawContract)
  let action: ActionDescriptor
  try {
    action = validateActionContractDescriptor(rawAction)
  } catch (error) {
    throw new ActionImplementationContractError(
      error instanceof Error ? error.message : "Action descriptor is invalid"
    )
  }
  if (
    contract.actionId !== action.id ||
    contract.actionVersion !== action.version ||
    contract.actionContractDigest !== action.contractDigest ||
    contract.actionErrorSchemaDigest !== action.errorSchema.digest
  ) {
    throw new ActionImplementationContractError(
      `implementation contract does not target exact Action ${action.id}@${action.version}`
    )
  }
  const declared = actionTypedFailureNames(action)
  if (action.errorSchema.shape === "structural") {
    if (canonicalJson(contract.typedFailures) !== canonicalJson(declared)) {
      throw new ActionImplementationContractError(
        `implementation typed failures ${contract.typedFailures.join(" | ") || "never"} do not exactly match ` +
        `Action ${action.id} failures ${declared.join(" | ") || "never"}`
      )
    }
    if (contract.failureSchemaDigest !== action.errorSchema.digest) {
      throw new ActionImplementationContractError(
        `implementation nominal failure schema does not exactly match Action ${action.id} error schema`
      )
    }
  } else if (contract.typedFailures.length > 0 || contract.failureSchemaDigest !== null) {
    throw new ActionImplementationContractError(
      `legacy Action ${action.id} cannot authenticate a nonempty typed failure row; use a structural compiler contract`
    )
  }
}

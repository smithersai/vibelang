/**
 * Host-detail helpers shared by the platform services. Panic escalation used to
 * live here too; it is a runtime invariant rather than a platform detail, so it
 * now ships as `rethrowPanics` from ../runtime/result.ts.
 */

/** Node's errno strings are the only structured detail an `fs`/`fetch` rejection carries. */
export function errnoCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const code: unknown = (cause as { readonly code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

export function causeDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  if (typeof cause === "string" && cause.length > 0) return cause;
  return "unknown cause";
}

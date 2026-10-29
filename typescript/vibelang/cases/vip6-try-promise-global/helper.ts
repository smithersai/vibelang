// A Promise-returning function a .vibe file wraps, as VIP-6 s example queryDb.
export const queryDb = async (q: string, options?: { signal?: AbortSignal }): Promise<string> => {
  if (q === "bad") throw new Error("rejected " + q)
  return `row ${q} ${options?.signal instanceof AbortSignal}`
}

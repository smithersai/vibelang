export function makeAuthenticate() {
  return async (value: string | null): Promise<string | undefined> => value ?? undefined
}

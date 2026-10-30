// A host-package declaration makes this fixture test resolved platform access.
export {}
declare global {
 var process: { env: Record<string, string | undefined> }
}

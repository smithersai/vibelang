/**
 * Ambient stand-in for the compiler-owned `"smithers:comptime"` module so the
 * example loader file below type-checks under this repository's ordinary
 * `tsc --noEmit` run.
 *
 * The compiler never reads this file. `loader-registration.ts` resolves the
 * module from its own private declaration and recognizes `comptime.loader` by
 * TypeScript checker identity, and the sandbox receives a lowered module with
 * the import erased.
 */
declare module "smithers:comptime" {
  export function comptime<T>(value: T): T
  export namespace comptime {
    const target: string
    interface LoaderRegistration {
      readonly type: string
    }
    function loader<A, C, M>(type: string, load: (asset: A, context: C) => M): LoaderRegistration
  }
  export function embed(specifier: string): string
}

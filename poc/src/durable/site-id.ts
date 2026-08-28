import { digest } from "./value.ts"

/**
 * Site identity for an effect request.
 *
 * `specification/effects.mdx` §Effect Requests: a request carries "a site
 * identity — content-addressed from the request's source position and its
 * enclosing function's identity, plus an occurrence index assigned at
 * dispatch".
 *
 * The scheme is the one the Plan lowerer already uses for `stableNodeID`
 * (`source-compiler.ts`, eight sites, all spelled
 * `src-${digest({ ...identity, occurrence }).slice(0, 24)}`), and the Go fork
 * agrees with it. It is lifted here unchanged so that when the journal key
 * becomes `siteId#occurrence` the two backends do not have to re-establish an
 * agreement they already have.
 *
 * Two occurrence counters are involved and they are NOT the same quantity:
 *
 * - the **compile-time** occurrence in {@link EffectSiteIds}, which exists only
 *   to keep two syntactically distinct sites that hash to the same identity
 *   from colliding, exactly as the Plan lowerer's does; and
 * - the **dispatch** occurrence index, assigned by the runtime in the
 *   scheduler's deterministic order and specified as the second half of a
 *   journal key. It is not a compile-time value and this module does not
 *   produce it.
 */
export interface EffectSiteIdentity {
  /** The enclosing model's file name. */
  readonly file: string
  /** The enclosing function's analysis-assigned name. */
  readonly functionName: string
  /** Which of the three request kinds this site issues. */
  readonly kind: "get" | "perform" | "abort"
  /** `line:character` of the request's source position, zero-based. */
  readonly anchor: string
  /** The request's nominal key, when the site has one. */
  readonly key?: string
}

/** The content-addressed half of a journal key. */
export const effectSiteId = (identity: EffectSiteIdentity, occurrence: number): string =>
  `src-${digest({ ...identity, occurrence }).slice(0, 24)}`

/**
 * Assigns site ids within one compilation unit, refusing a collision rather
 * than papering over it — the Plan lowerer raises `SMITHERS4199` on the same
 * condition, and a silently reused journal key is worse than a hard stop.
 */
export class EffectSiteIds {
  readonly #occurrences = new Map<string, number>()
  readonly #assigned = new Set<string>()

  assign(identity: EffectSiteIdentity): string {
    const key = digest(identity)
    const occurrence = this.#occurrences.get(key) ?? 0
    this.#occurrences.set(key, occurrence + 1)
    const id = effectSiteId(identity, occurrence)
    if (this.#assigned.has(id)) {
      throw new Error(`stable effect site id collision ${id}`)
    }
    this.#assigned.add(id)
    return id
  }
}

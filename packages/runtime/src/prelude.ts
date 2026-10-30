import { Data, SchemaAST } from "effect"
import type * as EffectModule from "effect/Effect"
import type * as ScopeModule from "effect/Scope"
import { customMatcher, type MatchHint } from "./match.js"

// The prelude (D4, D48): every .vibe file sees these exports without an import.
// Effect and Scope are both the effect module and a type, so `Effect<A, E, R>`
// means `Effect.Effect<A, E, R>` and `Scope` means `Scope.Scope`, while
// `Effect.gen` and `Scope.make` still reach the module.
export { Effect, Exit, Layer, Schema, Scope } from "effect"
export { pipe } from "effect/Function"
// D313: the Experimental namespace, what VibeLang adds where Effect lacks an API.
export * as Experimental from "./experimental/index.js"

/** D4: in a .vibe file, `Effect<A, E, R>` is `Effect.Effect<A, E, R>`. */
export type Effect<A, E = never, R = never> = EffectModule.Effect<A, E, R>

/** D48: in a .vibe file, the type `Scope` is `Scope.Scope`. */
export type Scope = ScopeModule.Scope

/**
 * D3: `TaggedError` is Effect's `Data.TaggedError`, with the pattern matching
 * proposal's custom matcher (D215): `when NotFound` tests that the subject is
 * tagged with the same name, and the extractor `NotFound(let error)` binds it.
 */
export const TaggedError: typeof Data.TaggedError = ((tag: string) => {
  const Base: any = Data.TaggedError(tag)
  Base[customMatcher] = function(this: abstract new(...args: any) => any, subject: unknown, hint?: MatchHint) {
    if (subject === null || (typeof subject !== "object" && typeof subject !== "function") || (subject as { _tag?: unknown })._tag !== tag) return false
    return hint?.matchType === "extractor" ? [subject] : true
  }
  return Base
}) as any

/**
 * D278: the base of `error Name extends Base`, a subclass of Base whose
 * instances carry their own tag and report it as their name, as
 * `Data.TaggedError` does for its own. The declaration's members declare the
 * tag's type, so the base keeps Base's type, its constructor and its statics.
 */
export const $errorSubclass = <B extends abstract new(...args: any) => { readonly _tag: string }>(
  base: B,
  tag: string
): B => {
  const Base = base as unknown as abstract new(...args: Array<any>) => { _tag: string }
  abstract class Tagged extends Base {
    constructor(...args: Array<any>) {
      super(...args)
      this._tag = tag
    }
  }
  Object.defineProperty(Tagged, customMatcher, {
    value(subject: unknown, hint?: MatchHint) {
      if (subject === null || (typeof subject !== "object" && typeof subject !== "function") || (subject as { _tag?: unknown })._tag !== tag) return false
      return hint?.matchType === "extractor" ? [subject] : true
    },
    configurable: true
  })
  ;(Tagged.prototype as unknown as { name: string }).name = tag
  return Tagged as unknown as B
}

/**
 * D278: what the constructor of `error Name extends Base { fields }` takes
 * when it writes none: what Base's constructor takes, plus the fields. Base's
 * constructor must take a single object of fields, as an error declared
 * without a constructor does; otherwise this is never (EK2118).
 */
export type $ErrorArgs<B, A> = B extends abstract new(args: infer P) => any ? ([P] extends [void] ? {} : P) & A : never

/**
 * D304: a schema error family. A value of a family base's type may be any of
 * its subclasses, so the base's schema accepts each subclass as well as its
 * own instances: it encodes an instance with the schema of the instance's own
 * class, and decodes by tag. The parser writes a static block in each class
 * of a family: the base of a family, a schema error with a `_tag` field or
 * `abstract`, calls $schemaErrorFamily, and every other schema error subclass
 * calls $schemaErrorMember. Each read of the base's schema is a new union,
 * which lists the subclasses defined before that schema first decodes or
 * encodes, so a struct built from the base at a module's top level also lists
 * the subclasses defined after it and before its first use.
 */
const schemaErrorFamilies = new WeakMap<object, Array<SchemaAST.AST>>()

// The schema Effect gives the class itself: its own fields and its own tag.
const ownSchemaErrorAst = (error: object): SchemaAST.AST => Reflect.get(Object.getPrototypeOf(error), "ast", error)

// Adds own, a subclass's own schema, to every family above it. The latest
// comes first, so a class that a reloaded module defines again wins its tag.
const joinSchemaErrorFamilies = (error: object, own: SchemaAST.AST): void => {
  for (let base = Object.getPrototypeOf(error); base !== null; base = Object.getPrototypeOf(base)) {
    schemaErrorFamilies.get(base)?.unshift(own)
  }
}

/** D304: joins a schema error subclass to the families above it. */
export const $schemaErrorMember = (error: abstract new(...args: any) => unknown): void => {
  joinSchemaErrorFamilies(error, ownSchemaErrorAst(error))
}

/**
 * D304: makes a schema error the base of a family, whose schema is the union
 * of its subclasses' own schemas and its own. The union sits behind a
 * suspension, which reads the subclasses when the schema first runs, inside
 * a union, which takes checks as a class's schema does.
 */
export const $schemaErrorFamily = (error: abstract new(...args: any) => unknown): void => {
  const own = ownSchemaErrorAst(error)
  joinSchemaErrorFamilies(error, own)
  const members: Array<SchemaAST.AST> = []
  schemaErrorFamilies.set(error, members)
  Object.defineProperty(error, "ast", {
    configurable: true,
    get: () => new SchemaAST.Union([new SchemaAST.Suspend(() => new SchemaAST.Union([...members, own]))])
  })
}

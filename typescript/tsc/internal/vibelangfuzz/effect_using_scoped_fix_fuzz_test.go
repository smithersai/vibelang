package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

const usingScopedFixTitle = "Acquire with acquireDisposable inside scoped"
const usingScopedNameQuote = "The naming context must be preserved or suppressed before creation, rather than repairing `.name` afterward: a class static initializer may already have observed it."
const usingScopedBindingQuote = "Bindings and jump targets are resolved on the source before any callback is introduced."
const usingScopedGroupingQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

// Each form states whether EK0801's fix is context-safe there.
var usingScopedForms = map[string]struct {
	source  string
	offered bool
}{
	"ambient-mapped":                   {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype Copy<R> = { [K in keyof R]: R[K] }; export effect function load<R>(job: Effect.Effect<number, never, Copy<R>>) { using resource = open(); return try job }\nconst instantiated = load<Scope.Scope>(Effect.as(Effect.scope, 1)); const preservesScope: ScopeRequirements<typeof instantiated> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-mapped-other-control":     {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype Other = { [K in \"other\"]: number }; export effect function load(job: Effect.Effect<number, never, Other>) { using resource = open(); return try job }\nconst preservesOther: ScopeRequirements<ReturnType<typeof load>> = {} as Other; void preservesOther\n", true},
	"ambient-direct":                   {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return try Effect.scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-arrow":                    {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport const load = effect () => { using resource = open(); return try Effect.scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-method":                   {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport class Reader { effect load() { using resource = open(); return try Effect.scope } }\nconst preservesScope: ScopeRequirements<ReturnType<Reader[\"load\"]>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-tag":                      {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return try Scope.Scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-alias-value":              {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nconst ambient = Effect.scope; export effect function load() { using resource = open(); return try ambient }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-alias-type":               {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype ExistingScope = Scope.Scope; export effect function load(job: Effect.Effect<number, never, ExistingScope>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-union":                    {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(job: Effect.Effect<number, never, Scope.Scope | OtherRequirement>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-subtype":                  {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ninterface ExistingScope extends Scope.Scope { readonly extra: true }; export effect function load(job: Effect.Effect<number, never, ExistingScope>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as ExistingScope; void preservesScope\n", false},
	"ambient-generic":                  {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load<R>(job: Effect.Effect<number, never, R>) { using resource = open(); return try job }\nconst instantiated = load<Scope.Scope>(Effect.as(Effect.scope, 1)); const preservesScope: ScopeRequirements<typeof instantiated> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-constrained":              {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load<R extends Scope.Scope>(job: Effect.Effect<number, never, R>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-class-head":               {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nclass Base { [Symbol.dispose]() {} }; export effect function load() { using resource = new (class extends (try Effect.as(Effect.scope, Base)) {})(); return 1 }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
	"ambient-prefix-control":           {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { const ambient = try Effect.scope; using resource = open(); return ambient }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", true},
	"ambient-unrelated-control":        {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(job: Effect.Effect<number, never, OtherRequirement>) { using resource = open(); return try job }\nconst preservesOther: ScopeRequirements<ReturnType<typeof load>> = {} as OtherRequirement; void preservesOther\n", true},
	"ambient-provided-control":         {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(ambient: Scope.Scope) { using resource = open(); provide Scope.Scope = ambient { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
	"ambient-nested-block-control":     {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return effect { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
	"ambient-nested-callable-control":  {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return effect () => { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
	"ambient-shadow-control":           {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { const Scope = 1; using resource = open(); return Scope }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
	"ambient-property-control":         {"interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = { Scope: 1, [Symbol.dispose]() {} }; return resource.Scope }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
	"comment-after-using":              {"export effect function load(): number!! { using /* resource note */ resource = open(); return 1 }", true},
	"comment-after-name":               {"export effect function load(): number!! { using resource /* resource note */ = open(); return 1 }", true},
	"comment-before-value":             {"export effect function load(): number!! { using resource = /* resource note */ open(); return 1 }", true},
	"comment-line-before-value":        {"export effect function load(): number!! { using resource = // resource note\n open(); return 1 }", true},
	"comment-after-value":              {"export effect function load(): number!! { using resource = open() /* resource note */; return 1 }", true},
	"comment-between-bindings":         {"export effect function load(): number!! { using resource = open(), /* resource note */ other = open(); return 1 }", true},
	"comment-inside-value":             {"export effect function load(): number!! { using resource = open(/* resource note */); return 1 }", true},
	"comment-before-using":             {"export effect function load(): number!! { /* resource note */ using resource = open(); return 1 }", true},
	"head-object-method":               {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ [try Effect.succeed(\"key\" as const)]() {}, [Symbol.dispose]() {} }); return 1 }", true},
	"head-object-getter":               {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ get [try Effect.succeed(\"key\" as const)]() { return 1 }, [Symbol.dispose]() {} }); return 1 }", true},
	"head-object-setter":               {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ set [try Effect.succeed(\"key\" as const)](value: number) {}, [Symbol.dispose]() {} }); return 1 }", true},
	"head-class-heritage":              {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class extends (try Effect.succeed(Base)) {})(); return 1 }", true},
	"head-class-method":                {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { [try Effect.succeed(\"key\" as const)]() {}; [Symbol.dispose]() {} })(); return 1 }", true},
	"head-class-static-method":         {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { static [try Effect.succeed(\"key\" as const)]() {}; [Symbol.dispose]() {} })(); return 1 }", true},
	"head-class-getter":                {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { get [try Effect.succeed(\"key\" as const)]() { return 1 }; [Symbol.dispose]() {} })(); return 1 }", true},
	"head-nested-object-method":        {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ nested: { [try Effect.succeed(\"key\" as const)]() {} }, [Symbol.dispose]() {} }); return 1 }", true},
	"head-object-effect-body":          {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ work: effect (): number!! => { try Effect.succeed(1); return try resource.work() }, [Symbol.dispose]() {} }); return try resource.work() }", true},
	"head-class-effect-body":           {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { effect work(): number!! { try Effect.succeed(1); return try resource.work() }; [Symbol.dispose]() {} })(); return try resource.work() }", true},
	"head-object-plain-body":           {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ work() { return 1 }, [Symbol.dispose]() {} }); return 1 }", true},
	"head-class-plain-body":            {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { work() { return 1 }; [Symbol.dispose]() {} })(); return 1 }", true},
	"head-class-effect-field":          {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class { program = effect { return try Effect.succeed(1) }; [Symbol.dispose]() {} })(); return try resource.program }", true},
	"head-class-static-effect-field":   {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class Local { static program = effect { return try Effect.succeed(1) }; get program() { return Local.program }; [Symbol.dispose]() {} })(); return try resource.program }", true},
	"head-plain-heritage":              {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = new (class extends Base {})(); return 1 }", true},
	"head-plain-computed-name":         {"class Base { [Symbol.dispose]() {} };\nexport effect function load(): number!! { using resource = ({ [\"key\"]() {}, [Symbol.dispose]() {} }); return 1 }", true},
	"head-shadowed-sync":               {"const sync = 0;\nexport effect function load(): number!! { using resource = open(); return 1 }", true},
	"object-asserted":                  {"export effect function load() { using resource = { [Symbol.dispose]() {} } as Disposable; return 1 }", true},
	"object-satisfies":                 {"export effect function load() { using resource = { [Symbol.dispose]() {} } satisfies Disposable; return 1 }", true},
	"object-nonnull":                   {"export effect function load() { using resource = { [Symbol.dispose]() {} }!; return 1 }", true},
	"object-asserted-nonnull":          {"export effect function load() { using resource = { [Symbol.dispose]() {} }! as Disposable; return 1 }", true},
	"object-satisfies-nonnull":         {"export effect function load() { using resource = { [Symbol.dispose]() {} }! satisfies Disposable; return 1 }", true},
	"object-double-asserted":           {"export effect function load() { using resource = { [Symbol.dispose]() {} } as unknown as Disposable; return 1 }", true},
	"object-multiline":                 {"export effect function load() { using resource = {\n  [Symbol.dispose]() {}\n} as Disposable; return 1 }", true},
	"object-bare":                      {"export effect function load() { using resource = { [Symbol.dispose]() {} }; return 1 }", true},
	"object-parenthesized":             {"export effect function load() { using resource = ({ [Symbol.dispose]() {} }); return 1 }", true},
	"object-wrapped-assertion":         {"export effect function load() { using resource = ({ [Symbol.dispose]() {} } as Disposable); return 1 }", true},
	"object-wrapped-satisfies":         {"export effect function load() { using resource = ({ [Symbol.dispose]() {} } satisfies Disposable); return 1 }", true},
	"object-wrapped-nonnull":           {"export effect function load() { using resource = ({ [Symbol.dispose]() {} }!); return 1 }", true},
	"object-inner-parentheses":         {"export effect function load() { using resource = ({ [Symbol.dispose]() {} }) as Disposable; return 1 }", true},
	"object-angle-assertion":           {"export effect function load() { using resource = <Disposable>{ [Symbol.dispose]() {} }; return 1 }", true},
	"object-conditional":               {"export effect function load() { using resource = true ? { [Symbol.dispose]() {} } : { [Symbol.dispose]() {} }; return 1 }", true},
	"object-factory":                   {"export effect function load() { using resource = open(); return 1 }", true},
	"binding-hoisted-function":         {"const later = 2;\nexport effect function load() { const read = later; using r = open(); function later() { return 1 }; return read() }", false},
	"binding-closure-const":            {"const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const later = 1; return read() }", false},
	"binding-closure-let":              {"const later = 2;\nexport effect function load() { const read = () => later; using r = open(); let later = 1; return read() }", false},
	"binding-closure-destructuring":    {"const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const { later } = { later: 1 }; return read() }", false},
	"binding-closure-shorthand":        {"const later = 2;\nexport effect function load() { const read = () => ({ later }); using r = open(); const later = 1; return read().later }", false},
	"binding-closure-class":            {"const later = 2;\nexport effect function load() { const read = () => new Later().value; using r = open(); class Later { value = 1 }; return read() }", false},
	"binding-closure-enum":             {"const later = 2;\nexport effect function load() { const read = (): number => Later.Value; using r = open(); enum Later { Value = 1 }; return read() }", false},
	"binding-closure-resource":         {"const later = 2;\nexport effect function load() { const read = () => r; using r = open(); return read() }", false},
	"binding-prefix-function":          {"const later = 2;\nexport effect function load() { function read() { return later }; using r = open(); const later = 1; return read() }", false},
	"binding-type-alias":               {"const later = 2;\nexport effect function load() { type Before = Later; using r = open(); type Later = number; const result: Before = 1; return result }", false},
	"binding-interface":                {"const later = 2;\nexport effect function load() { interface Before extends Later {}; using r = open(); interface Later { value: number }; const result: Before = { value: 1 }; return result.value }", false},
	"binding-type-query":               {"const later = 2;\nexport effect function load() { type Before = typeof later; using r = open(); const later = 1; const result: Before = 1; return result }", false},
	"binding-outer-fallback":           {"const later = 2;\nexport effect function load() { const read = () => later; using r = open(); const later = 3; return read() }", false},
	"binding-outer-shorthand-fallback": {"const later = 2;\nexport effect function load() { const read = () => ({ later }); using r = open(); const later = 3; return read().later }", false},
	"binding-suffix-closure":           {"const later = 2;\nexport effect function load() { using r = open(); const read = () => later; const later = 1; return read() }", true},
	"binding-prefix-local":             {"const later = 2;\nexport effect function load() { const earlier = 1; const read = () => earlier; using r = open(); const later = 2; return read() + later }", true},
	"binding-shadowed-parameter":       {"const later = 2;\nexport effect function load() { const read = (later: number) => later; using r = open(); const later = 1; return read(later) }", true},
	"binding-property-name":            {"const later = 2;\nexport effect function load() { const earlier = { later: 1 }; using r = open(); const later = 2; return earlier.later + later }", true},
	"binding-type-property-name":       {"const later = 2;\nexport effect function load() { type Before = { later: number }; using r = open(); const later = 2; const result: Before = { later }; return result.later }", true},
	"binding-nested-block-binding":     {"const later = 2;\nexport effect function load() { const read = () => { const later = 1; return later }; using r = open(); const later = 2; return read() + later }", true},
	"name-anonymous-class":             {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", false},
	"name-parenthesized":               {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} }); return 1 }", false},
	"name-double-parenthesized":        {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = ((class { static observed = this.name; static [Symbol.dispose]() {} })); return 1 }", false},
	"name-satisfies":                   {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} } satisfies Disposable); return 1 }", false},
	"name-asserted":                    {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} } as Disposable); return 1 }", false},
	"name-nonnull":                     {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class { static observed = this.name; static [Symbol.dispose]() {} })!; return 1 }", false},
	"name-generic":                     {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class<T> { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", false},
	"name-extends":                     {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class extends Base { static observed = this.name }; return 1 }", false},
	"name-named-class":                 {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class Kept { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", true},
	"name-named-parenthesized":         {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = (class Kept { static observed = this.name; static [Symbol.dispose]() {} }); return 1 }", true},
	"name-named-extends":               {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = class Kept extends Base { static observed = this.name }; return 1 }", true},
	"name-identifier":                  {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = Known; return 1 }", true},
	"name-factory":                     {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = make(); return 1 }", true},
	"name-constructed":                 {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = new (class { [Symbol.dispose]() {} })(); return 1 }", true},
	"name-conditional":                 {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = choose() ? class { static observed = this.name; static [Symbol.dispose]() {} } : class { static observed = this.name; static [Symbol.dispose]() {} }; return 1 }", true},
	"name-object-property":             {"class Base { static [Symbol.dispose]() {} }; const Known = class { static observed = this.name; static [Symbol.dispose]() {} }; const make = () => class { static observed = this.name; static [Symbol.dispose]() {} }; const choose = () => true;\nexport effect function load() { using resource = { Nested: class { static observed = this.name; static [Symbol.dispose]() {} }, [Symbol.dispose]() {} }; return 1 }", true},
	"function":                         {"export effect function load() { using r = open(); return 1 }", true},
	"arrow":                            {"export const load = effect () => { using r = open(); return 1 }", true},
	"method":                           {"export class Loader { effect load() { using r = open(); return 1 } }", true},
	"no-rest":                          {"export effect function load() { using r = open() }", true},
	"two-values":                       {"export effect function load() { using a = open(), b = open(); return 2 }", true},
	"before":                           {"export effect function load() { const n = 1; using r = open(); return n }", true},
	"object-literal":                   {"export effect function load() { using r = { [Symbol.dispose]() { } }; return 1 }", true},
	"multiline":                        {"export effect function load() {\n  using r = open()\n  const n = 1\n  return n\n}", true},
	"producer":                         {"export effect function* load() { using r = open(); yield 1 }", false},
	"nested-block":                     {"export effect function load() { { using r = open() } return 1 }", false},
	"for-head":                         {"export effect function load() { for (using r of [open()]) { } return 1 }", false},
	"null":                             {"export effect function load() { using r = null; return 1 }", false},
	"effect-operand":                   {"export effect function load() { using r = try Effect.succeed(open()); return 1 }", false},
	"shadowed-scoped":                  {"const scoped = 1\nexport effect function load() { using r = open(); return scoped }", false},
}

func TestEffectUsingScopedFixQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", usingScopedNameQuote)
	chapterSays(t, "007-tooling.md", effectUsingWarningQuote)
	chapterSays(t, "008-runtime.md", usingScopedBindingQuote)
	chapterSays(t, "007-tooling.md", usingScopedGroupingQuote)
}

func FuzzEffectUsingScopedFix(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", usingScopedNameQuote)
	chapterSays(f, "008-runtime.md", usingScopedBindingQuote)
	chapterSays(f, "007-tooling.md", usingScopedGroupingQuote)
	for key := range usingScopedForms {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	sessions := newToolsSessions(f, w)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		form, ok := usingScopedForms[key]
		if !ok {
			key, form = "function", usingScopedForms["function"]
		}
		source := "const open = (): Disposable => ({ [Symbol.dispose]() { } })\n" + form.source + "\n"
		if mode&1 != 0 {
			source = "// café 😀\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		result := toolsCompile(t, w, "FuzzEffectUsingScopedFix", files)
		defer result.Remove()
		editor := &toolsEditor{t: t, ctx: t.Context(), sessions: sessions, session: sessions.get(t), w: w, r: result, files: files, archive: Archive(files), main: "main.vibe", uri: toolsURI(result.Dir, "main.vibe")}
		var err error
		editor.run("didOpen", func() {
			editor.session.DidOpenFile(editor.ctx, editor.uri, 1, source, toolsLanguage)
			editor.service, err = editor.session.GetLanguageService(editor.ctx, editor.uri)
		})
		defer func() {
			if sessions.current == editor.session {
				editor.run("didClose", func() { editor.session.DidCloseFile(editor.ctx, editor.uri) })
			}
		}()
		if err != nil {
			t.Fatal(err)
		}
		items, ok := toolsRequest(editor, "using diagnostics", func(service *ls.LanguageService) ([]*lsproto.Diagnostic, error) {
			return toolsDiagnostics(t.Context(), service, editor.uri)
		})
		if !ok {
			t.Fatal("missing using diagnostics response")
		}
		if !toolsErrorFree(result) {
			t.Fatalf("invalid original: %v", result.Diagnostics)
		}
		gapKey := "using-scoped-fix:" + key
		var diagnostic *lsproto.Diagnostic
		for _, item := range items {
			if code, _ := toolsDiagnosticCode(item); code == 801 {
				diagnostic = item
				break
			}
		}
		if diagnostic == nil {
			Gap(t, "FuzzEffectUsingScopedFix", gapKey, "missing EK0801: %s", source)
			return
		}
		response, ok := toolsRequest(editor, "using scoped", func(service *ls.LanguageService) (lsproto.CodeActionResponse, error) {
			return service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: editor.uri}, Range: diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}}})
		})
		found := false
		if ok && response.CommandOrCodeActionArray != nil {
			for _, item := range *response.CommandOrCodeActionArray {
				action := item.CodeAction
				if action == nil || action.Edit == nil || action.Title != usingScopedFixTitle {
					continue
				}
				found = true
				edited, _ := editor.apply(gapKey, action.Title, action.Edit)
				if edited == nil {
					Gap(t, "FuzzEffectUsingScopedFix", gapKey, "invalid scoped edit")
					continue
				}
				if strings.Count(edited["main.vibe"], "resource note") != strings.Count(source, "resource note") {
					Gap(t, "FuzzEffectUsingScopedFix", gapKey, "%s must retain declaration comments: %s", usingScopedGroupingQuote, edited["main.vibe"])
				}
				checked, err := w.Compile(t.Context(), Project{Files: edited})
				if err != nil {
					t.Fatal(err)
				}
				defer checked.Remove()
				if !toolsErrorFree(checked) || !strings.Contains(edited["main.vibe"], "try acquireDisposable(") || !strings.Contains(edited["main.vibe"], "return try scoped(effect {") {
					Gap(t, "FuzzEffectUsingScopedFix", gapKey, "%s must typecheck: %v\n%s", effectUsingWarningQuote, checked.Diagnostics, edited["main.vibe"])
				}
				for _, d := range checked.Diagnostics {
					if d.Code() == 801 {
						Gap(t, "FuzzEffectUsingScopedFix", gapKey, "the fix left a using: %v\n%s", d, edited["main.vibe"])
					}
				}
			}
		}
		if found != form.offered {
			Gap(t, "FuzzEffectUsingScopedFix", gapKey, "offered %v, want %v: %s", found, form.offered, source)
		}
	})
}

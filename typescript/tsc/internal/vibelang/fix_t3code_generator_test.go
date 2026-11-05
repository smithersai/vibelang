package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestFixT3CodeGeneratorReduction(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"nested fn", `export const make = Effect.gen(function* () {
 const writeCatalog = Effect.fn("write")(function* (catalog: string) { return catalog })
 return { writeCatalog }
})
`},
		{"captured requirement", `export class Users extends Context.Service<Users, { readonly find: (id: string) => Effect.Effect<string> }>()("t3code/Users") {}
export class Store extends Context.Service<Store, { readonly set: (catalog: string) => Effect.Effect<boolean> }>()("t3code/Store") {}
export const make = Effect.gen(function* () {
 const users = yield* Users
 const encryptionAvailable = Effect.succeed(true).pipe(Effect.map((v) => v))
 return Store.of({
  set: Effect.fn("store.set")(function* (catalog) {
   if (!(yield* encryptionAvailable)) return false
   yield* users.find(catalog)
   return true
  })
 })
})
`},
		{"nested gen", `export const make = Effect.gen(function* () {
 const migrate = Effect.gen(function* () { return 1 })
 return { migrate }
})
`},
		{"contextual literal", `type Catalog = { readonly schemaVersion: 1 }
export const migrate: (records: ReadonlyArray<string>) => Effect.Effect<Catalog> = Effect.fn("migrate")(function* (records) {
 const targets: string[] = []
 for (const record of records) targets.push(record)
 return { schemaVersion: 1 }
})
`},
		{"annotated generator with stages", `export const load = Effect.fn("load")(function* <T>(x: T): Effect.fn.Return<T> {
 const same = yield* Effect.gen(function* () { return x })
 return same
}, Effect.withSpan("post"))
`},
		{"annotated generator changing success type", `export const load = Effect.fn(function* (x: number): Effect.fn.Return<number> {
 return x
}, Effect.map((value) => String(value)))
`},
		{"annotated span literal", `type Catalog = { readonly schemaVersion: 1 }
export const migrate = Effect.fn("migrate")(function* (records: readonly string[]): Effect.fn.Return<Catalog> {
 const targets: string[] = []
 for (const record of records) targets.push(record)
 return { schemaVersion: 1 }
})
`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, result := fixedPipe(t, tc.source)
			if strings.Contains(got, "function*") {
				t.Fatalf("generator remains:\n%s\nrefusals: %+v", got, result.Refused)
			}
		})
	}
}

// Native generator exception handling remains JavaScript. The optional teaching
// planner still explains why it cannot safely turn that body into effect code.
func TestT3CodeNativeGeneratorExceptionBoundary(t *testing.T) {
	source := "export const make = Effect.gen(function* () { try { return yield* Effect.succeed(1) } catch { return 0 } })\n"
	got, result := fixedPipe(t, source)
	if got != source || len(result.Sites) != 0 || len(result.Refused) != 0 {
		t.Fatalf("native generator changed: %s; sites %+v; refusals %+v", got, result.Sites, result.Refused)
	}
	p, file, _, _ := editorProgram(t, source)
	c, done := p.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	found := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) {
			plan := planEffectGen(c, file, n)
			if plan != nil && strings.Contains(plan.why, "a try statement in a generator catches JavaScript exceptions") {
				if plan.fixable() {
					t.Fatal("unsafe native exception rewrite offered")
				}
				found = true
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if !found {
		t.Fatal("planner lost its semantic explanation")
	}
}

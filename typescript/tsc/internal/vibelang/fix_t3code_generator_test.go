package vibelang

import (
	"strings"
	"testing"
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

// A migration refusal must name its semantic obstruction, rather than repeat
// EK1002's generic rewrite advice and hide the planner's explanation.
func TestT3CodeGeneratorRefusalReason(t *testing.T) {
	source := "export const make = Effect.gen(function* () { try { return yield* Effect.succeed(1) } catch { return 0 } })\n"
	_, result := fixedPipe(t, source)
	for _, site := range result.Sites {
		if site.Code == "EK1002" {
			if !strings.Contains(site.Reason, "a try statement in a generator catches JavaScript exceptions") {
				t.Fatalf("missing semantic refusal reason: %+v", site)
			}
			return
		}
	}
	t.Fatal("no refused EK1002 site")
}

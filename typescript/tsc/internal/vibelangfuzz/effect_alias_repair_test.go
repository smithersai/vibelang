package vibelangfuzz

import (
	"path/filepath"
	"testing"
)

var effectAliasRepairShapes = []struct {
	key, declaration, arguments string
	repair                      bool
}{
	{"reordered", "export type Effect<A, E = never, R = never> = Base.Effect<E, A, R>", "number, string", false},
	{"default-error", "export type Effect<A, E = string> = Base.Effect<A, E>", "number", false},
	{"array-success", "export type Effect<A> = Base.Effect<ReadonlyArray<A>>", "number", false},
	{"required-service", "export type Effect<A> = Base.Effect<A, never, { readonly required: true }>", "number", false},
	{"union", "export type Effect<A> = Base.Effect<A> | Base.Effect<string>", "number", false},
	{"branded-interface", "export interface Effect<A> extends Base.Effect<A> { readonly brand: string }", "number", false},
	{"intersection", "export type Effect<A> = Base.Effect<A> & { readonly brand: string }", "number", false},
	{"different-interface", "export interface Program<A> extends Base.Effect<A> { readonly brand: string }", "number", false},
	{"forwarding", "export type Effect<A, E = never, R = never> = Base.Effect<A, E, R>", "number, string", true},
	{"official", "", "number, string", true},
	// Defaults, chains, and fixed slots test the instantiated contract rather
	// than the alias's name or parameter count.
	{"forwarding-defaults", "export type Effect<A, E = never, R = never> = Base.Effect<A, E, R>", "number", true},
	{"forwarding-chain", "type Forward<A, E, R> = Base.Effect<A, E, R>; export type Effect<A, E = never, R = never> = Forward<A, E, R>", "number, string", true},
	{"fixed-error", "export type Effect<A, E = never> = Base.Effect<A, string>", "number, Error", false},
	{"nested-array", "export type Effect<A> = Base.Effect<ReadonlyArray<ReadonlyArray<A>>>", "number", false},
	{"lookalike-interface", "export interface Effect<A, E = never, R = never> { readonly \"~effect/Effect\": { readonly _A: () => A; readonly _E: () => E; readonly _R: () => R }; readonly extra: true }", "number, string", false},
}

func effectAliasStock(t testing.TB) string {
	t.Helper()
	path := declarationIdentityAPI(t)
	if packageVersion(path) != "5.9.3" {
		Missing(t, "Effect alias oracle requires stock tsc 5.9.3: install experiments' pinned TypeScript or set EFFECT_NODE_MODULES to an install containing typescript@5.9.3")
	}
	return filepath.Join(path, "bin/tsc")
}

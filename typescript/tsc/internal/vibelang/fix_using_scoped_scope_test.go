package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixAmbientScope(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"ambient-direct", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return try Effect.scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-arrow", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport const load = effect () => { using resource = open(); return try Effect.scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-method", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport class Reader { effect load() { using resource = open(); return try Effect.scope } }\nconst preservesScope: ScopeRequirements<ReturnType<Reader[\"load\"]>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-tag", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return try Scope.Scope }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-alias-value", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nconst ambient = Effect.scope; export effect function load() { using resource = open(); return try ambient }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-alias-type", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype ExistingScope = Scope.Scope; export effect function load(job: Effect.Effect<number, never, ExistingScope>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-union", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(job: Effect.Effect<number, never, Scope.Scope | OtherRequirement>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-subtype", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ninterface ExistingScope extends Scope.Scope { readonly extra: true }; export effect function load(job: Effect.Effect<number, never, ExistingScope>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as ExistingScope; void preservesScope\n", false},
		{"ambient-generic", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load<R>(job: Effect.Effect<number, never, R>) { using resource = open(); return try job }\nconst instantiated = load<Scope.Scope>(Effect.as(Effect.scope, 1)); const preservesScope: ScopeRequirements<typeof instantiated> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-constrained", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load<R extends Scope.Scope>(job: Effect.Effect<number, never, R>) { using resource = open(); return try job }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-class-head", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nclass Base { [Symbol.dispose]() {} }; export effect function load() { using resource = new (class extends (try Effect.as(Effect.scope, Base)) {})(); return 1 }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-prefix-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { const ambient = try Effect.scope; using resource = open(); return ambient }\nconst preservesScope: ScopeRequirements<ReturnType<typeof load>> = {} as Scope.Scope; void preservesScope\n", true},
		{"ambient-unrelated-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(job: Effect.Effect<number, never, OtherRequirement>) { using resource = open(); return try job }\nconst preservesOther: ScopeRequirements<ReturnType<typeof load>> = {} as OtherRequirement; void preservesOther\n", true},
		{"ambient-provided-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load(ambient: Scope.Scope) { using resource = open(); provide Scope.Scope = ambient { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
		{"ambient-nested-block-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return effect { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
		{"ambient-nested-callable-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = open(); return effect () => { return try Effect.scope } }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
		{"ambient-shadow-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { const Scope = 1; using resource = open(); return Scope }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
		{"ambient-property-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\nexport effect function load() { using resource = { Scope: 1, [Symbol.dispose]() {} }; return resource.Scope }\nconst preservesNever: [ScopeRequirements<ReturnType<typeof load>>] extends [never] ? true : false = true; void preservesNever\n", true},
		{"ambient-mapped", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype Copy<R> = { [K in keyof R]: R[K] }; export effect function load<R>(job: Effect.Effect<number, never, Copy<R>>) { using resource = open(); return try job }\nconst instantiated = load<Scope.Scope>(Effect.as(Effect.scope, 1)); const preservesScope: ScopeRequirements<typeof instantiated> = {} as Scope.Scope; void preservesScope\n", false},
		{"ambient-mapped-other-control", "interface OtherRequirement { readonly other: unique symbol }\ntype ScopeRequirements<T> = T extends Effect.Effect<infer A, infer E, infer R> ? R : never\ntype Other = { [K in \"other\"]: number }; export effect function load(job: Effect.Effect<number, never, Other>) { using resource = open(); return try job }\nconst preservesOther: ScopeRequirements<ReturnType<typeof load>> = {} as Other; void preservesOther\n", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "const open = (): Disposable => ({ [Symbol.dispose]() {} });" + tc.source
			program, file, service, converters := editorProgram(t, source)
			warnings, offered := 0, 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid original: %s", d.String())
				}
				if d.Code() != EK0801.Code {
					continue
				}
				warnings++
				actions, err := usingScopedActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
				if err != nil {
					t.Fatal(err)
				}
				for _, action := range actions {
					if action.Description != "Acquire with acquireDisposable inside scoped" {
						continue
					}
					offered++
					edited := applyEditorEdits(t, file, converters, action.Changes)
					checked, changed, _, _ := editorProgram(t, edited)
					for _, problem := range append(checked.GetSyntacticDiagnostics(t.Context(), changed), checked.GetSemanticDiagnostics(t.Context(), changed)...) {
						if problem.Category() == diagnostics.CategoryError {
							if tc.offer {
								t.Errorf("invalid repair: %s", problem.String())
							} else {
								t.Logf("unsafe edit changes the original contract: %s", problem.String())
							}
						}
					}
				}
			}
			want := 0
			if tc.offer {
				want = 1
			}
			if warnings != 1 || offered != want {
				t.Fatalf("warnings %d; actions %d, want %d", warnings, offered, want)
			}
		})
	}
}

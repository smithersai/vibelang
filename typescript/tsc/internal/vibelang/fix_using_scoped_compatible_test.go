package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func TestUsingScopedFixCompatibleRequirements(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		offer        bool
	}{
		{"compatible-object", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = object;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-empty", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = {};\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-boxed-object", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Object;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-alias", "interface OtherRequirement { readonly other: unique symbol }\ntype Broad = object;\ntype Requirement = Broad;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-empty-interface", "interface OtherRequirement { readonly other: unique symbol }\ninterface EmptyRequirement {}\ntype Requirement = EmptyRequirement;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-empty-class", "interface OtherRequirement { readonly other: unique symbol }\nclass EmptyRequirement {}\ntype Requirement = EmptyRequirement;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-readonly-empty", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Readonly<{}>;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-mapped-empty", "interface OtherRequirement { readonly other: unique symbol }\ntype EmptyRequirement = { [Key in never]: unknown };\ntype Requirement = EmptyRequirement;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-union", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = object | string;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-intersection", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = object & {};\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-never-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = never;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", true},
		{"compatible-other-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = OtherRequirement;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", true},
		{"compatible-other-class-control", "interface OtherRequirement { readonly other: unique symbol }\nclass OtherClass { readonly other = 1 }\ntype Requirement = OtherClass;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", true},
		{"compatible-disjoint-intersection-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = object & OtherRequirement;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", true},
		{"compatible-mapped-other-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Other = { [Key in \"other\"]: number };\ntype Requirement = Other;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", true},
		{"compatible-scope-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Scope.Scope;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-unknown-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = unknown;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-partial-scope-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Partial<Scope.Scope>;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-scope-union-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Scope.Scope | OtherRequirement;\nconst acceptsScope: Requirement = {} as Scope.Scope; void acceptsScope;\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
		{"compatible-scope-intersection-control", "interface OtherRequirement { readonly other: unique symbol }\ntype Requirement = Scope.Scope & { readonly extra: true };\nexport effect function load(job: Effect.Effect<boolean, never, Requirement>) { using resource = open(); return try job }\n", false},
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

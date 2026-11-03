package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClassBaseFailureFix(t *testing.T) {
	for name, declaration := range map[string]string{
		"heritage":    `class C extends JSON.parse("invalid") {}`,
		"struct":      `schema error E { value: { readonly [JSON.parse("invalid")]: string } }`,
		"optional":    `schema error E { value?: { readonly [JSON.parse("invalid")]: string } }`,
		"array":       `schema error E { value: Array<{ readonly [JSON.parse("invalid")]: string }> }`,
		"tuple":       `schema error E { value: [{ readonly [JSON.parse("invalid")]: string }] }`,
		"nested-call": `schema error E { value: { readonly [JSON.parse(JSON.stringify("key")!)]: string } }`,
	} {
		t.Run(name, func(t *testing.T) {
			source := "export effect function f(): number!! {\n " + declaration + "\n return 1\n}\n"
			_, file, _, _ := editorProgram(t, source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "try Effect.orDie(Effect.try({ try: () => JSON.parse(") || len(result.Refused) != 0 {
				t.Fatalf("missing preserving fix: %+v, refused %+v", fixed, result.Refused)
			}
			if codes := errorCodesOf(t, fixed.Text); len(codes) != 0 {
				t.Fatalf("fixed code reports %v\n%s", codes, fixed.Text)
			}
			if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
				t.Fatal(err)
			}
			if again := fixCase(t, filepath.Dir(file.FileName().AsString())); len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("fix is not idempotent: %+v", again)
			}
		})
	}
}

func TestClassBaseFailureFixKeepsExplicitEffects(t *testing.T) {
	source := "error KeyError\ndeclare const key: Effect.Effect<string, KeyError>\nexport effect function f(): number!! {\n schema error E { value: { readonly [try key]: string } }\n return 1\n}\n"
	_, file, _, _ := editorProgram(t, source)
	for _, fixed := range fixCase(t, filepath.Dir(file.FileName().AsString())).Files {
		if strings.Contains(fixed.Text, "Effect.orDie") {
			t.Fatalf("an explicit Effect's failure must stay typed:\n%s", fixed.Text)
		}
	}
}

func TestClassBaseFailureFixAdmittedOuterCall(t *testing.T) {
	source := "import { wrap, OuterError } from \"./foreign.js\"\nexport effect function f(): number!OuterError! {\n schema error E { value: { readonly [wrap(JSON.parse(\"invalid\"))]: string } }\n return 1\n}\n"
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/schema-error-effect-keys"), root)
	main := filepath.Join(dir, "main.vibe")
	foreign := "export class OuterError extends Error { readonly _tag = \"OuterError\" }\n/** @throws {OuterError} */\nexport function wrap(value: unknown): string { return \"key\" }\n"
	if err := os.WriteFile(filepath.Join(dir, "foreign.ts"), []byte(foreign), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(main, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	var text string
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			text = fixed.Text
		}
	}
	if !strings.Contains(text, "try Effect.orDie(Effect.try({ try: () => wrap(JSON.parse(") || result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("missing outer-call repair: %s, result %+v", text, result)
	}
	if err := os.WriteFile(main, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("outer-call repair is not idempotent: %+v", again)
	}
}

func TestClassBaseFailureFixKeepsAdmittedBuiltinErrors(t *testing.T) {
	source := "declare const key: string!SyntaxError!\nexport effect function f(): number!TypeError! {\n schema error E { value: { readonly [try key]: string } }\n return 1\n}\n"
	if codes := errorCodesOf(t, source); len(codes) != 0 {
		t.Fatalf("TypeScript's structurally compatible Error types report %v", codes)
	}
	_, file, _, _ := editorProgram(t, source)
	if result := fixCase(t, filepath.Dir(file.FileName().AsString())); len(result.Files) != 0 || len(result.Refused) != 0 {
		t.Fatalf("an admitted error needs no preserving rewrite: %+v", result)
	}
}

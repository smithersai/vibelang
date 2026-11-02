package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-10 denies an implicit lookup through S.member, including when try is
// written before the call. Actual properties of the key keep their TS meaning.
func TestVIP10ServiceShorthand(t *testing.T) {
	prefix := "interface Shape { find(id: string): string!!; value(): number; name(): string }\nservice Users: Shape { static readonly key = \"vip10/users\" }\n"
	for _, test := range []struct {
		name, body string
		code       int32
	}{
		{"effect method", "export effect function f() { return try Users.find(\"42\") }", 2339},
		{"held method", "export effect function f() { return Users.find(\"42\") }", 2339},
		{"plain member", "export effect function f() { return Users.value() }", 2339},
		{"ordinary function", "export function f() { return Users.value() }", 2339},
		{"top level", "export const x = Users.value()", 2339},
		{"member value", "export effect function f() { return Users.value }", 2339},
		{"class name value", "export effect function f() { const n: string = Users.name; return n }", 0},
		{"class name call", "export effect function f() { return Users.name() }", 2349},
		{"key value", "export effect function f() { const k: string = Users.key; return k }", 0},
		{"key call", "export effect function f() { return Users.key() }", 2349},
		{"explicit effect", "export effect function f() { return try (try Users).find(\"42\") }", 0},
		{"explicit plain", "export effect function f() { return (try Users).value() }", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.body)
			errors := program.GetSemanticDiagnostics(t.Context(), file)
			found := false
			for _, d := range errors {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() == "" && d.Code() == test.code {
					found = true
					continue
				}
				t.Errorf("unexpected error: %s", d.String())
			}
			if test.code != 0 && !found {
				t.Errorf("missing TS%d; got %v", test.code, errors)
			}
		})
	}
}

func TestVIP10ServiceShorthandMigration(t *testing.T) {
	prefix := "interface Shape { find(id: string): string!!; value(): number }\nservice Users: Shape { static readonly key = \"vip10/users\" }\n"
	for _, call := range []string{"try Users.find(\"42\")", "Users.find(\"42\")", "Users.value()", "try Users.value()"} {
		t.Run(call, func(t *testing.T) {
			source := prefix + "export effect function f() { return " + call + " }\n"
			result, name := fixVIP10Source(t, source)
			want := strings.Replace(source, "Users.", "(try Users).", 1)
			if call == "try Users.value()" {
				want = strings.Replace(source, call, "( (try Users).value())", 1)
			}
			if got := result.Files[name]; got == nil || got.Text != want {
				t.Fatalf("got %+v; want %s; refused %+v", got, want, result.Refused)
			}
			again, _ := fixVIP10Source(t, want)
			if len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}

func fixVIP10Source(t *testing.T, source string) (*FixResult, tspath.RootedFilePath) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	configName := filepath.Join(dir, "tsconfig.json")
	// Keep the helper's project config; it requests no output.
	if _, err := os.Stat(configName); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatal(errors)
	}
	return FixProject(t.Context(), fs, bundled.LibPath(), config), file.FileName()
}

// These calls have ordinary TypeScript meaning or an optional evaluation
// boundary. The migration must not silently introduce an Effect lookup.
func TestVIP10ServiceShorthandMigrationSafety(t *testing.T) {
	prefix := "interface Shape { find(id: string): string!!; value(): number }\nservice Users: Shape { static readonly key = \"vip10/users\" }\n"
	for _, body := range []string{
		"export effect function f() { return Users.find?.(\"42\") }",
		"export effect function f() { return Users?.find(\"42\") }",
		"export effect function f() { return Users.name }",
		"export effect function f() { return Users.key }",
		"export effect function f() { return Users.missing() }",
		"export function f() { return Users.value() }",
		"export effect function f() { function inner() { return Users.value() }; return inner() }",
		"export effect function f() { return try (try Users).find(\"42\") }",
	} {
		t.Run(body, func(t *testing.T) {
			result, _ := fixVIP10Source(t, prefix+body+"\n")
			if len(result.Files) != 0 || len(result.Refused) != 0 {
				t.Fatalf("unexpected migration: %+v", result)
			}
		})
	}
}

func TestVIP10PlainMemberTryTrivia(t *testing.T) {
	prefix := "service Users { static readonly key=\"vip10/trivia\"; value():number }\n"
	for _, body := range []string{
		"return try (\nUsers.value()\n)",
		"return try /* before lookup */ Users.value()",
		"return try (// before lookup\nUsers.value())",
		"return try (Users.value())",
		"let prior=2\ntry Users.value()\nreturn prior",
	} {
		t.Run(body, func(t *testing.T) {
			source := prefix + "export effect function f(){" + body + "}\n"
			result, name := fixVIP10Source(t, source)
			fixed := result.Files[name]
			if result.Err != nil || len(result.Refused) > 0 || fixed == nil {
				t.Fatalf("missing plain-call migration: err=%v refused=%+v", result.Err, result.Refused)
			}
			program, file, _, _ := editorProgram(t, fixed.Text)
			if syntax := program.GetSyntacticDiagnostics(t.Context(), file); len(syntax) > 0 {
				t.Fatalf("invalid fixed syntax: %v\n%s", syntax, fixed.Text)
			}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source rejected: %s\n%s", diagnosticWithNotes(d), fixed.Text)
				}
			}
			for _, comment := range []string{"/* before lookup */", "// before lookup"} {
				if strings.Count(source, comment) != strings.Count(fixed.Text, comment) {
					t.Fatalf("comment changed: %s", fixed.Text)
				}
			}
			again, _ := fixVIP10Source(t, fixed.Text)
			if again.Err != nil || len(again.Files) > 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}

func TestVIP10ServiceKeyCompletions(t *testing.T) {
	source := "service Users {static readonly key=\"vip10/completions\"; find(n:number):number!!; value:number}\nexport effect function f(){return Users. }"
	_, file, service, _ := editorProgram(t, source)
	result, err := service.GetCompletionsAtPosition(t.Context(), file, strings.Index(source, "Users.")+len("Users."), nil, true)
	if err != nil || result == nil {
		t.Fatalf("completions: result=%v err=%v", result, err)
	}
	names := map[string]bool{}
	for _, item := range result.Items {
		names[item.Label] = true
	}
	if names["find"] || names["value"] || !names["key"] {
		t.Fatalf("completion list exposes implementation or loses native key: %v", names)
	}
}

// A syntax-recovered call cannot establish the old expression boundaries.
func TestVIP10RecoveredSyntaxStaysUnchanged(t *testing.T) {
	source := "service Users {static readonly key=\"vip10/recovery\"; value():number}\nexport effect function f(){const broken = ; return Users.value()}"
	result, _ := fixVIP10Source(t, source)
	if len(result.Files) > 0 {
		t.Fatalf("rewrote a syntax-recovered service call: %+v", result)
	}
}

func TestVIP10EffectMemberValueCalls(t *testing.T) {
	prefix := "service Journal { read: number!!; name: number!!; static readonly key = \"vip10/value\" }\n"
	for _, call := range []string{"try Journal.read()", "Journal.read()", "(Journal.read()).toFixed()"} {
		t.Run(call, func(t *testing.T) {
			source := prefix + "export effect function f(){ return " + call + " }\n"
			result, name := fixVIP10Source(t, source)
			if len(result.Refused) > 0 || result.Files[name] == nil {
				t.Fatalf("missing value migration: %+v", result)
			}
			fixed := result.Files[name].Text
			if strings.Contains(fixed, ".read()") || !strings.Contains(fixed, "(try Journal).read") {
				t.Fatalf("bad value migration: %s", fixed)
			}
			again, _ := fixVIP10Source(t, fixed)
			if len(again.Files) > 0 || len(again.Refused) > 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
	result, _ := fixVIP10Source(t, prefix+"export effect function f(){return Journal.name()}\n")
	if len(result.Files) > 0 {
		t.Fatal("rewrote a native key property through its Effect-valued implementation")
	}
}

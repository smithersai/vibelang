package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Chapter 7: "A quick fix is offered only when it preserves evaluation order,
// coldness, types, comments, and declaration output". A schema declaration
// declares its constant and typeof X.Type under one name (D501), and a
// declaration file prints every declaration of a name it prints. So in a
// project with declaration sidecars, a private Schema.Struct constant with no
// type of its name keeps its form when the declaration file names it, through
// a type query, an export list or export default: otherwise the declaration
// file gains type X = typeof X.Type, and an export list exports it. opencode's
// xai-responses, openai-decisions, openai-images and mistral-chat protocols
// gained such a line. A constant the declaration file does not name still
// becomes a schema declaration, and every declaration stays byte-identical.
func TestSchemaConstantKeepsPrivateDeclaredConstant(t *testing.T) {
	for _, test := range []struct {
		name, source string
		kept         bool
	}{
		{"type query", "const Options = Schema.Struct({ minP: Schema.optional(Schema.Number) })\nexport type OptionsInput = typeof Options.Type\nexport const decode = Schema.decodeUnknownSync(Options)\n", true},
		{"helper type query", "const Usage = Schema.Struct({ input: Schema.Number })\nexport interface Shape { readonly usage?: Schema.Schema.Type<typeof Usage> }\n", true},
		{"export list", "const Listed = Schema.Struct({ id: Schema.String })\nexport { Listed }\n", true},
		{"renamed export", "const Listed = Schema.Struct({ id: Schema.String })\nexport { Listed as Public }\n", true},
		{"export default", "const Fallback = Schema.Struct({ ok: Schema.Boolean })\nexport default Fallback\n", true},
		{"namespace member", "export namespace N {\n  const Inner = Schema.Struct({ id: Schema.String })\n  export type InnerType = typeof Inner.Type\n}\n", true},
		{"value use only", "const Hidden = Schema.Struct({ id: Schema.String })\nexport const decodeHidden = Schema.decodeUnknownSync(Hidden)\n", false},
		{"inferred reference", "const Usage = Schema.Struct({ input: Schema.Number })\nexport const Wrapped = Schema.Struct({ usage: Usage })\n", false},
		{"local constant", "export function make() {\n  const Local = Schema.Struct({ value: Schema.String })\n  type T = typeof Local.Type\n  const t: T = { value: \"v\" }\n  return t\n}\n", false},
		{"own type beside it", "const Paired = Schema.Struct({ id: Schema.String })\ntype Paired = typeof Paired.Type\nexport type PairedInput = typeof Paired.Type\n", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, test.source)
			dir := filepath.Dir(file.FileName().AsString())
			configName := filepath.Join(dir, "tsconfig.json")
			if err := os.WriteFile(configName, []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`), 0o600); err != nil {
				t.Fatal(err)
			}
			fs := bundled.WrapFS(osvfs.FS())
			config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
			if len(errors) != 0 {
				t.Fatalf("config: %v", errors)
			}
			parsed := &fixParsedFiles{}
			declaration := func(texts map[tspath.RootedFilePath]string) string {
				program := fixProgram(fs, bundled.LibPath(), config, parsed, texts)
				out := ""
				var mutex sync.Mutex
				program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
					if strings.HasSuffix(name.AsString(), "/main.d.ts") {
						mutex.Lock()
						out = text
						mutex.Unlock()
					}
					return nil
				}})
				return out
			}
			before := declaration(nil)
			if before == "" {
				t.Fatal("missing baseline declaration")
			}
			result := FixProject(t.Context(), fs, bundled.LibPath(), config)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			got := test.source
			if fixed := result.Files[file.FileName()]; fixed != nil {
				got = fixed.Text
			}
			if converted := strings.Contains(got, "schema "); converted == test.kept {
				t.Fatalf("--fix wrote\n%s\nwant the constant kept=%v", got, test.kept)
			}
			if after := declaration(map[tspath.RootedFilePath]string{file.FileName(): got}); after != before {
				t.Fatalf("--fix changed the declaration:\nbefore\n%s\nafter\n%s\nsource\n%s", before, after, got)
			}
		})
	}
}

// Chapter 7 gives every module a declaration sidecar, so disabling ordinary
// declaration emit cannot authorize adding a type beside a printed constant.
func TestSchemaConstantPrivateDeclaredConstantWithoutDeclarations(t *testing.T) {
	source := "const Options = Schema.Struct({ minP: Schema.optional(Schema.Number) })\nexport type OptionsInput = typeof Options.Type\n"
	for _, options := range []string{`"noEmit":true`, `"declaration":false`} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,` + options + `},"files":["main.vibe"]}`
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}
		result := fixCase(t, dir)
		got := source
		if fixed := result.Files[file.FileName()]; fixed != nil {
			got = fixed.Text
		}
		if result.Err != nil || len(result.Refused) != 0 || got != source {
			t.Fatalf("%s: --fix changed the private declaration: %s; error=%v refused=%v", options, got, result.Err, result.Refused)
		}
	}
}

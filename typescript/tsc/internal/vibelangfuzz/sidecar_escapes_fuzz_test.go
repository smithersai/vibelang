package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const sidecarEscapesQuote = "TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files."

func sidecarEscapesChapter(tb testing.TB) {
	tb.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, quote := range []string{sidecarEscapesQuote, "Declarations are exactly what idiomatic Effect TypeScript would declare."} {
		if !strings.Contains(string(text), quote) {
			tb.Fatalf("Chapter 1 no longer says %q", quote)
		}
	}
}

func TestSidecarEscapesQuoted(t *testing.T) { sidecarEscapesChapter(t) }

var sidecarEscapesNames = []struct{ key, stem string }{
	{"plain", "model"}, {"space", "odd name"}, {"apostrophe", "odd'name"},
	{"double-quote", "odd\"name"}, {"both-quotes", "both'\"quotes"},
	{"unicode", "café"}, {"code-point", "星"}, {"surrogate-pair", "face😀"},
}
var sidecarEscapesForms = []struct{ key, source string }{
	{"reexport", "export { value } from %s\n"},
	{"star", "export * from %s\n"},
	{"import", "import { value } from %s\nexport { value }\n"},
	{"import-type", "export type Value = typeof import(%s).value\n"},
}

type sidecarEscapesInput struct {
	name, form     int
	native, single bool
	style          string
	escapes        []byte
}

// Keyed inputs survive reordering: <name>/<form>/<vibe|native>/<single|double>/<style>/<escape bytes>.
func parseSidecarEscapes(data []byte) sidecarEscapesInput {
	at := func(i int) int {
		if i < len(data) {
			return int(data[i])
		}
		return 0
	}
	in := sidecarEscapesInput{
		name: at(0) % len(sidecarEscapesNames), form: at(1) % len(sidecarEscapesForms),
		native: at(2)&1 != 0, single: at(3)&1 != 0,
		style: []string{".js", ".ts", "extensionless"}[at(4)%3], escapes: data,
	}
	parts := strings.SplitN(string(data), "/", 6)
	if len(parts) == 6 {
		for i, n := range sidecarEscapesNames {
			if parts[0] == n.key {
				in.name = i
			}
		}
		for i, f := range sidecarEscapesForms {
			if parts[1] == f.key {
				in.form = i
			}
		}
		in.native, in.single = parts[2] == "native", parts[3] == "single"
		switch parts[4] {
		case ".js", ".ts", "extensionless":
			in.style = parts[4]
		}
		in.escapes = []byte(parts[5])
	}
	return in
}

// Spell every rune independently: ordinary text, escaped delimiter, hex,
// Unicode code unit(s), or Unicode code point. Prefix dots and slashes can
// be escaped too; file names are always the decoded value.
func sidecarEscapesString(value string, single bool, data []byte) string {
	q := '"'
	if single {
		q = '\''
	}
	var b strings.Builder
	b.WriteRune(q)
	for i, r := range []rune(value) {
		mode := 0
		if len(data) > 0 {
			mode = int(data[i%len(data)]) % 4
		}
		switch {
		case mode == 1 && r < 256:
			fmt.Fprintf(&b, "\\x%02x", r)
		case mode == 2:
			for _, unit := range utf16.Encode([]rune{r}) {
				fmt.Fprintf(&b, "\\u%04x", unit)
			}
		case mode == 3:
			fmt.Fprintf(&b, "\\u{%x}", r)
		default:
			if r == q || r == '\\' {
				b.WriteByte('\\')
			}
			b.WriteRune(r)
		}
	}
	b.WriteRune(q)
	return b.String()
}

func FuzzSidecarEscapes(f *testing.F) {
	startShortBudget(f)
	sidecarEscapesChapter(f)
	w, stock := NewWorkspace(f), StockTypeScript(f)
	for i, n := range sidecarEscapesNames {
		f.Add([]byte(n.key + "/" + sidecarEscapesForms[i%len(sidecarEscapesForms)].key + "/vibe/single/.js/0123"))
	}
	f.Add([]byte("unicode/reexport/native/double/.ts/3210"))
	f.Add([]byte("both-quotes/import-type/native/single/extensionless/1203"))
	f.Fuzz(func(t *testing.T, data []byte) {
		checkSidecarEscapes(t, w, stock, parseSidecarEscapes(data))
	})
}

func checkSidecarEscapes(t *testing.T, w *Workspace, stock string, in sidecarEscapesInput) {
	t.Helper()
	const target = "FuzzSidecarEscapes"
	defer recoverCompilerPanic(t, target)
	name, form := sidecarEscapesNames[in.name], sidecarEscapesForms[in.form]
	kind, quote := "vibe", "double"
	if in.native {
		kind = "native"
	}
	if in.single {
		quote = "single"
	}
	key := strings.Join([]string{name.key, form.key, kind, quote, in.style}, "/")
	stem, ext := name.stem, ".vibe"
	if in.native {
		ext = ".ts"
	}
	path := "./" + stem + ".js"
	if in.native {
		path = "./" + stem + ".ts"
	}
	literal := sidecarEscapesString(path, in.single, in.escapes)
	source := fmt.Sprintf(form.source, literal)
	options := map[string]any{
		"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
		"strict": true, "skipLibCheck": false, "types": []string{},
		"declaration": true, "emitDeclarationOnly": true, "allowImportingTsExtensions": true, "outDir": "out",
	}
	cfg, err := json.Marshal(map[string]any{
		"compilerOptions": options, "files": []string{"main.vibe"},
		"vibe":     map[string]any{"effectGlobals": false, "effectModules": false},
		"vibelang": map[string]any{"declarationImportStyle": in.style},
	})
	if err != nil {
		t.Fatal(err)
	}
	c, err := w.CompileOrdered(t.Context(), Project{
		Files:  map[string]string{"main.vibe": source, stem + ext: "export const value: 7 = 7\n"},
		Config: string(cfg),
	}, OrderTsc, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Remove()
	if HasError(c.Diagnostics) || c.Program == nil {
		Gap(t, target, key, "chapter 1: %s; generated source must resolve: %s\n%v", sidecarEscapesQuote, source, c.Diagnostics)
		return
	}
	// Confirm the source's real resolver selected the generated target.
	file := c.SourceFile("main.vibe")
	resolved := c.Program.GetResolvedModuleFromModuleSpecifier(file, sidecarEscapesModuleLiteral(file))
	wantSource := filepath.ToSlash(filepath.Join(c.Dir, stem+ext))
	if resolved == nil || string(resolved.ResolvedFileName) != wantSource {
		Gap(t, target, key, "chapter 1: %s; source import did not resolve to %s: %+v\n%s", sidecarEscapesQuote, wantSource, resolved, source)
		return
	}
	var sidecar string
	ds := c.Program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
		if filepath.Base(name) == "main.d.vibe.ts" {
			sidecar = text
		}
		return os.WriteFile(name, []byte(text), 0o600)
	})
	if (ds != nil && HasError(ds.Diagnostics)) || sidecar == "" {
		Gap(t, target, key, "chapter 1: %s; missing or invalid sidecar: %v\n%s", sidecarEscapesQuote, ds, source)
		return
	}
	// Check a stock consumer with skipLibCheck disabled. Its literal 7
	// contract rejects any unrelated sibling, and --traceResolution proves
	// every import in the main sidecar selects the source's matching file.
	consumer := "import { value } from \"./main.vibe\"\nconst checked: 7 = value\n"
	if form.key == "import-type" {
		consumer = "import type { Value } from \"./main.vibe\"\nconst checked: Value = 7\n"
	}
	if err := os.WriteFile(filepath.Join(c.Dir, "consumer.ts"), []byte(consumer), 0o600); err != nil {
		t.Fatal(err)
	}
	options["noEmit"], options["emitDeclarationOnly"], options["allowArbitraryExtensions"] = true, false, true
	consumerCfg, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{"consumer.ts"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(c.Dir, "consumer.json"), consumerCfg, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, stock, "-p", "consumer.json", "--pretty", "false", "--traceResolution")
	cmd.Dir = c.Dir
	out, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("stock sidecar consumer timed out: %v", ctx.Err())
	}
	wantTarget := wantSource
	if !in.native {
		wantTarget = strings.TrimSuffix(wantSource, tspath.ExtensionVibe) + ".d.vibe.ts"
	}
	if runErr != nil || !strings.Contains(string(out), "successfully resolved to '"+wantTarget+"'") {
		Gap(t, target, key, "chapter 1: %s; stock tsc must resolve sidecar to source target %s: %v\nsource:\n%s\nsidecar:\n%s\n%s", sidecarEscapesQuote, wantTarget, runErr, source, sidecar, out)
		return
	}
	ExpectPending(t, target, key)
	ExpectPending(t, target, specCorpusKey(t))
}

// Generated sources contain one module-reference literal and no other strings.
func sidecarEscapesModuleLiteral(file *ast.SourceFile) *ast.Node {
	var literal *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsStringLiteral(node) {
			literal = node
			return true
		}
		return node.ForEachChild(visit)
	}
	visit(file.AsNode())
	return literal
}

// An escaping mutation may not silently turn a seed into another filename,
// and keyed corpus inputs must retain their shape when the tables are reordered.
func TestSidecarEscapesGenerator(t *testing.T) {
	for _, name := range sidecarEscapesNames {
		for _, single := range []bool{false, true} {
			for _, escapes := range []string{"0000", "1111", "2222", "3333", "0123"} {
				value := "./" + name.stem + ".js"
				source := fmt.Sprintf(sidecarEscapesForms[0].source, sidecarEscapesString(value, single, []byte(escapes)))
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.ts", PathKey: "/main.ts"}, source, core.ScriptKindTS)
				literal := sidecarEscapesModuleLiteral(file)
				if len(file.Diagnostics()) != 0 || literal == nil || literal.Text() != value {
					t.Fatalf("escaping generator changed %q: %s", value, source)
				}
				quote := "double"
				if single {
					quote = "single"
				}
				in := parseSidecarEscapes([]byte(name.key + "/import-type/native/" + quote + "/extensionless/" + escapes))
				if sidecarEscapesNames[in.name].key != name.key || sidecarEscapesForms[in.form].key != "import-type" || !in.native || in.single != single || in.style != "extensionless" || string(in.escapes) != escapes {
					t.Fatalf("keyed generator lost its input: %+v", in)
				}
			}
		}
	}
}

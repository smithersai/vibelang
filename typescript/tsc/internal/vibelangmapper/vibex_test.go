package vibelangmapper

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/contentmapper"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VIP-39: ".vibex is to .vibe what .tsx is to .ts".
// JSX punctuation/text stays verbatim while VibeLang expressions in containers lower.
func TestVibexProjection(t *testing.T) {
	for _, source := range []string{
		"export const view = <p title=\"% |> ! &amp;\">hé😀 {/* c */}<b /></p>",
		"export const view = <><UI.Box<string> {...props} data-x={value} />text</>",
		"export const view = <p>{1 |> % + 2}</p>",
		"export effect function view() { return <p>{try Effect.succeed(1)}</p> }",
		"export const id = <T,>(x: T) => <p>{x}</p>",
	} {
		t.Run(source, func(t *testing.T) {
			ctx := FileContext{FileName: "/app/src/view.vibex", ModuleKey: "app/src/view"}
			for name, render := range map[string]func(string, FileContext) Projection{"checking": Project, "executable": Executable} {
				result := render(source, ctx)
				if len(result.Diagnostics) != 0 {
					t.Fatalf("%s diagnostics: %+v\n%s", name, result.Diagnostics, result.Text)
				}
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/view.tsx")}, result.Text, core.ScriptKindTSX)
				if len(file.Diagnostics()) != 0 {
					t.Fatalf("%s is not TSX: %+v\n%s", name, file.Diagnostics(), result.Text)
				}
				mapping := spanmap.New(result.Segments)
				if err := mapping.Validate(result.Text, source); err != nil {
					t.Fatal(err)
				}
				for _, token := range []string{"<p", "</p>", "<>", "</>", "<UI.Box", "<b />", "hé😀", "text", "/* c */", "% |> ! &amp;"} {
					at := strings.Index(source, token)
					if at < 0 {
						continue
					}
					virtual := strings.Index(result.Text, token)
					if virtual < 0 {
						t.Fatalf("%s lost JSX %q: %s", name, token, result.Text)
					}
					original, fidelity := mapping.VirtualToOriginalSpan(core.NewTextRange(virtual, virtual+len(token)))
					if !fidelity.IsExact() || original.Pos() != at || original.End() != at+len(token) {
						t.Fatalf("%s JSX %q map = %v (%v), want %d", name, token, original, fidelity, at)
					}
				}
			}
		})
	}
}

func TestVibexTransformExtension(t *testing.T) {
	for _, extension := range []string{".vibe", ".vibex"} {
		result, err := (&Handler{}).transform([]byte(`{"fileName":"/view` + extension + `","content":"export const view = <p />"}`))
		if err != nil {
			t.Fatal(err)
		}
		want := ".ts"
		if extension == ".vibex" {
			want = ".tsx"
		}
		if got := result.(contentmapper.TransformResult).Extension; got != want {
			t.Fatalf("%s projects as %s, want %s", extension, got, want)
		}
	}
}

func TestVibexMapperCacheOptions(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/package.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		TypeScript struct {
			ContentMapper struct{ CompilerOptions []string }
		}
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	mapper := contentmapper.Mapper{Manifest: contentmapper.Manifest{
		Name: "vibelang-ts-mapper", CompilerOptions: manifest.TypeScript.ContentMapper.CompilerOptions,
	}}
	base := mapper.TransformIdentity(&core.CompilerOptions{})
	for name, options := range map[string]*core.CompilerOptions{
		"jsx preserve":       {Jsx: core.JsxEmitPreserve},
		"jsx react":          {Jsx: core.JsxEmitReact},
		"jsx react-jsx":      {Jsx: core.JsxEmitReactJSX},
		"jsx react-jsxdev":   {Jsx: core.JsxEmitReactJSXDev},
		"jsx react-native":   {Jsx: core.JsxEmitReactNative},
		"jsxFactory":         {JsxFactory: "h"},
		"jsxFragmentFactory": {JsxFragmentFactory: "Fragment"},
		"jsxImportSource":    {JsxImportSource: "custom-jsx"},
		"reactNamespace":     {ReactNamespace: "CustomReact"},
	} {
		if mapper.TransformIdentity(options) == base {
			t.Errorf("mapper cache does not invalidate for %s", name)
		}
		twin := options.Clone()
		if mapper.TransformIdentity(twin) != mapper.TransformIdentity(options) {
			t.Errorf("cache is unstable for %s", name)
		}
	}
}

func TestVibexModuleKey(t *testing.T) {
	read := func(name string) ([]byte, error) {
		if name == "/app/package.json" {
			return []byte(`{"name":"app"}`), nil
		}
		return nil, os.ErrNotExist
	}
	if got := moduleKey("/app/src/view.vibex", read); got != moduleKey("/app/src/view.vibe", read) {
		t.Fatalf("extension changed module key: %q", got)
	}
}

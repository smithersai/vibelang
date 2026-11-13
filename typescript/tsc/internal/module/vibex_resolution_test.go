package module

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"testing"
)

// VIP-39: explicit VibeLang extensions substitute like .ts/.tsx; runtime
// extensions keep native implementations ahead of migrated implementations.
// rule-evidence: docs/design/vips/0039-vibex.md#e535a097b3309cc4
// VIP-39: vibex source file-kind selection
func TestVibexResolutionPriority(t *testing.T) {
	files := map[string]string{"/repo/main.ts": ""}
	for _, name := range []string{"a.ts", "b.tsx", "c.vibe", "d.vibex", "e.vibe", "e.vibex", "f.tsx", "f.vibex", "g.vibex", "g.d.vibex.ts", "h.d.ts", "dir/index.vibex"} {
		files["/repo/"+name] = "export const value = 1;"
	}
	for _, mode := range []core.ModuleResolutionKind{core.ModuleResolutionKindBundler, core.ModuleResolutionKindNode10, core.ModuleResolutionKindNodeNext} {
		for _, row := range []struct {
			stem string
			want [5]string
		}{
			{"a", [5]string{"a.ts", "a.ts", "a.ts", "", ""}},
			{"b", [5]string{"b.tsx", "b.tsx", "b.tsx", "", ""}},
			{"c", [5]string{"c.vibe", "c.vibe", "c.vibe", "c.vibe", "c.vibe"}},
			{"d", [5]string{"d.vibex", "d.vibex", "d.vibex", "d.vibex", "d.vibex"}},
			{"e", [5]string{"e.vibe", "e.vibe", "e.vibex", "e.vibe", "e.vibex"}},
			{"f", [5]string{"f.tsx", "f.tsx", "f.tsx", "f.vibex", "f.vibex"}},
			{"g", [5]string{"g.vibex", "g.vibex", "g.vibex", "g.vibex", "g.vibex"}},
			{"h", [5]string{"h.d.ts", "h.d.ts", "h.d.ts", "h.d.ts", "h.d.ts"}},
		} {
			for i, ext := range []string{"", ".js", ".jsx", ".vibe", ".vibex"} {
				t.Run(fmt.Sprintf("%v/%s%s", mode, row.stem, ext), func(t *testing.T) {
					fs := vfstest.FromMap(files, tspath.CaseSensitive)
					host := &resolutionTestInputs{fs: fs, cwd: "/repo"}
					opts := &core.CompilerOptions{ModuleResolution: mode, Module: core.ModuleKindNodeNext, Jsx: core.JsxEmitReact}
					resolver := NewResolver(ResolverOptions{Host: host, CompilerOptions: opts})
					got, _, err := resolver.ResolveModuleName("./"+row.stem+ext, "/repo/main.ts", core.ModuleKindCommonJS, nil)
					if err != nil {
						t.Fatal(err)
					}
					want := row.want[i]
					if want != "" {
						want = "/repo/" + want
					}
					if string(got.ResolvedFileName) != want {
						t.Fatalf("resolved %q, want %q", got.ResolvedFileName, want)
					}
				})
			}
		}
	}
}

func TestVibexResolutionSuffixesAndExports(t *testing.T) {
	for _, row := range []struct {
		name, specifier, want string
		suffixes              []string
		files                 map[string]string
	}{
		{"directory", "./dir", "/repo/dir/index.vibex", nil, map[string]string{"/repo/dir/index.vibex": ""}},
		{"suffix", "./d.js", "/repo/d.web.vibex", []string{".web", ""}, map[string]string{"/repo/d.web.vibex": "", "/repo/d.vibex": ""}},
		{"paired-sidecar", "./d.vibex", "/repo/d.vibex", nil, map[string]string{"/repo/d.vibex": "", "/repo/d.d.vibex.ts": ""}},
		{"suffix-sidecar", "./d.js", "/repo/d.vibex", []string{"", ".d.vibex"}, map[string]string{"/repo/d.vibex": "", "/repo/d.d.vibex.ts": ""}},
		{"explicit-sidecar", "./d.vibex", "/repo/d.d.vibex.ts", nil, map[string]string{"/repo/d.d.vibex.ts": ""}},
		{"exports", "pkg", "/repo/node_modules/pkg/d.d.vibex.ts", nil, map[string]string{
			"/repo/node_modules/pkg/package.json": `{"name":"pkg","exports":{".":{"types":"./d.d.vibex.ts","default":"./d.js"}}}`,
			"/repo/node_modules/pkg/d.d.vibex.ts": "export const value: number;",
		}},
	} {
		t.Run(row.name, func(t *testing.T) {
			row.files["/repo/main.ts"] = ""
			fs := vfstest.FromMap(row.files, tspath.CaseSensitive)
			opts := &core.CompilerOptions{ModuleResolution: core.ModuleResolutionKindBundler, Module: core.ModuleKindESNext, Jsx: core.JsxEmitReact, ModuleSuffixes: row.suffixes}
			resolver := NewResolver(ResolverOptions{Host: &resolutionTestInputs{fs: fs, cwd: "/repo"}, CompilerOptions: opts})
			got, _, err := resolver.ResolveModuleName(row.specifier, "/repo/main.ts", core.ModuleKindESNext, nil)
			if err != nil {
				t.Fatal(err)
			}
			if string(got.ResolvedFileName) != row.want {
				t.Fatalf("resolved %q, want %q", got.ResolvedFileName, row.want)
			}
		})
	}
}

// JSX sources do not relax NodeNext's ESM requirement for an explicit extension.
func TestVibexResolutionNodeNextESM(t *testing.T) {
	fs := vfstest.FromMap(map[string]string{"/repo/main.ts": "", "/repo/d.vibex": ""}, tspath.CaseSensitive)
	opts := &core.CompilerOptions{ModuleResolution: core.ModuleResolutionKindNodeNext, Module: core.ModuleKindNodeNext, Jsx: core.JsxEmitReact}
	resolver := NewResolver(ResolverOptions{Host: &resolutionTestInputs{fs: fs, cwd: "/repo"}, CompilerOptions: opts})
	for _, row := range []struct{ specifier, want string }{{"./d", ""}, {"./d.js", "/repo/d.vibex"}, {"./d.vibex", "/repo/d.vibex"}} {
		got, _, err := resolver.ResolveModuleName(row.specifier, "/repo/main.ts", core.ModuleKindESNext, nil)
		if err != nil {
			t.Fatal(err)
		}
		if string(got.ResolvedFileName) != row.want {
			t.Errorf("%s resolved %s, want %s", row.specifier, got.ResolvedFileName, row.want)
		}
	}
}

// VIP-39: vibex source file-kind selection

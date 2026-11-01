package modulespecifiers

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/json"
	"github.com/microsoft/TypeScript/tsc/internal/packagejson"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func vibeExports(t testing.TB, text string) packagejson.ExportsOrImports {
	t.Helper()
	var exports packagejson.ExportsOrImports
	if err := json.Unmarshal([]byte(text), &exports); err != nil {
		t.Fatalf("exports %s: %v", text, err)
	}
	return exports
}

func vibeExportName(t testing.TB, target, exports string) string {
	t.Helper()
	host := &mockModuleSpecifierGenerationHost{caseSensitivity: tspath.CaseSensitive}
	return tryGetModuleNameFromExports(&core.CompilerOptions{}, host, tspath.RootedFilePathFromNormalized(target), "/repo/lib", "lib", vibeExports(t, exports), []string{"types", "import"}).AsString()
}

// opencode-45: once a bare specifier resolves to a workspace package's .vibe
// source, a .ts declaration that names one of its types must name the module
// by the package export that selects it, `import("lib/x").Provider<number>`,
// as stock TypeScript does for the .ts original. The migrate flow's export
// shape names the module under vibelang-source and its sidecar under types.
func TestVibeModuleNamedByItsPackageExport(t *testing.T) {
	t.Parallel()
	const entry = `{"types":"./src/x.d.vibe.ts","vibelang-source":"./src/x.vibe","default":"./.vibelang/js/src/x.js"}`
	for _, tc := range []struct{ name, target, exports, want string }{
		{"opencode exact entry", "/repo/lib/src/x.vibe", `{"./x":` + entry + `}`, "lib/x"},
		{"pattern entry", "/repo/lib/src/x.vibe", `{"./*":{"types":"./src/*.d.vibe.ts","vibelang-source":"./src/*.vibe","default":"./.vibelang/js/src/*.js"}}`, "lib/x"},
		{"nested condition", "/repo/lib/src/x.vibe", `{"./x":{"import":` + entry + `}}`, "lib/x"},
		{"fallback array", "/repo/lib/src/x.vibe", `{"./x":[` + entry + `,"./.vibelang/js/src/x.js"]}`, "lib/x"},
		{"sidecar under types only", "/repo/lib/src/x.vibe", `{"./x":{"types":"./src/x.d.vibe.ts","default":"./.vibelang/js/src/x.js"}}`, "lib/x"},
		{"earlier shape", "/repo/lib/src/x.vibe", `{"./x":{"types":"./src/x.d.vibe.ts","default":"./src/x.vibe"}}`, "lib/x"},
		{"package root", "/repo/lib/src/x.vibe", `{".":` + entry + `}`, "lib"},
		{"another module's entry", "/repo/lib/src/y.vibe", `{"./x":` + entry + `}`, ""},
		{"a .ts module is not a .vibe source", "/repo/lib/src/x.ts", `{"./x":{"vibelang-source":"./src/x.ts","default":"./dist/x.js"}}`, ""},
		{"emitted JavaScript alone", "/repo/lib/src/x.vibe", `{"./x":{"default":"./.vibelang/js/src/x.js"}}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := vibeExportName(t, tc.target, tc.exports); got != tc.want {
				t.Fatalf("%s for %s: got %q, want %q", tc.exports, tc.target, got, tc.want)
			}
		})
	}
}

// FuzzVibeModuleExport generates export maps for a .vibe module: an exact,
// pattern or root entry, wrapped in a condition or a fallback array or not,
// with any subset of the sidecar under types, the source under
// vibelang-source and the emitted JavaScript by default. The module is named
// by the entry exactly when one of its targets is the source or its sidecar;
// the emitted JavaScript alone, or another module's entry, names nothing.
func FuzzVibeModuleExport(f *testing.F) {
	for _, key := range []string{"exact:none:7", "pattern:none:7", "root:import:3", "exact:array:2", "pattern:import:1", "exact:none:4", "exact:none:0"} {
		f.Add(key, "x")
	}
	f.Fuzz(func(t *testing.T, key, module string) {
		parts := strings.Split(key, ":")
		if len(parts) != 3 || module == "" || strings.ContainsAny(module, "*\"\\/.") || len(module) > 12 {
			return
		}
		for _, c := range module {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
				return
			}
		}
		kind, wrap := parts[0], parts[1]
		var mask int
		if _, err := fmt.Sscanf(parts[2], "%d", &mask); err != nil || mask < 0 || mask > 7 {
			return
		}
		subpath, star := "./"+module, module
		if kind == "pattern" {
			subpath, star = "./*", "*"
		} else if kind == "root" {
			subpath = "."
		} else if kind != "exact" {
			return
		}
		var conditions []string
		if mask&1 != 0 {
			conditions = append(conditions, `"types":"./src/`+star+`.d.vibe.ts"`)
		}
		if mask&2 != 0 {
			conditions = append(conditions, `"vibelang-source":"./src/`+star+`.vibe"`)
		}
		if mask&4 != 0 {
			conditions = append(conditions, `"default":"./.vibelang/js/src/`+star+`.js"`)
		}
		if len(conditions) == 0 {
			return
		}
		value := "{" + strings.Join(conditions, ",") + "}"
		switch wrap {
		case "import":
			value = `{"import":` + value + `}`
		case "array":
			value = "[" + value + `,"./.vibelang/js/src/` + star + `.js"]`
		case "none":
		default:
			return
		}
		exports := `{"` + subpath + `":` + value + `}`
		want := ""
		if mask&3 != 0 {
			want = map[string]string{"exact": "lib/" + module, "pattern": "lib/" + module, "root": "lib"}[kind]
		}
		if got := vibeExportName(t, "/repo/lib/src/"+module+".vibe", exports); got != want {
			t.Fatalf("%s: got %q, want %q", exports, got, want)
		}
		if got := vibeExportName(t, "/repo/lib/src/"+module+"-other.vibe", exports); got != "" && kind != "pattern" {
			t.Fatalf("%s names %s-other.vibe as %q", exports, module, got)
		}
	})
}

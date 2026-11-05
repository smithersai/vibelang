package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const plainCatchBindingQuote = "A `try { } catch { }` statement at the top level, or in a plain or `async` function, is JavaScript's, as in TypeScript."
const legacyCatchBindingQuote = "a typed legacy `catch` clause names a union member without a literal `_tag`."

func TestCatchBindingAnnotationKindsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), plainCatchBindingQuote) || !strings.Contains(SpecText("900-appendices.md"), legacyCatchBindingQuote) {
		t.Fatal("missing native or legacy catch binding rule")
	}
}

const catchBindingConfig = `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"outDir":"out"}}`

func TestNativeAnyCatchBindingTwin(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	dir := filepath.Join(Root(), "typescript/vibelang/cases/catch-typed-destructured-parameter")
	source, err := os.ReadFile(filepath.Join(dir, "typescript/main.ts"))
	if err != nil {
		t.Fatal(err)
	}
	vibe, err := os.ReadFile(filepath.Join(dir, "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	if string(source) != string(vibe) {
		t.Fatal("the native counterpart changed the authored program")
	}
	want := stockDeclaration(t, w, tsc, Project{Files: map[string]string{"main.ts": string(source)}, Config: catchBindingConfig}, "out/main.d.ts")
	result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": string(source)}, Config: catchBindingConfig})
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	if HasError(result.Diagnostics) {
		t.Fatal(SortedKeys(Keys(result.Dir, result.Diagnostics)))
	}
	if diff := compareDeclarationTexts(t, want, result.Outputs["out/main.d.ts"]); diff != "" {
		t.Fatal(diff)
	}
	t.Log("stock tsc: unchanged any catch binding accepted with zero errors")
}
func FuzzCatchBindingAnnotationKinds(f *testing.F) {
	startShortBudget(f)
	tsc := StockTypeScript(f)
	w := NewWorkspace(f)
	for _, key := range []string{"identifier-any", "destructured-any", "rest-any", "renamed-any", "array-any", "unicode-any", "identifier-unknown", "legacy-number", "legacy-record", "legacy-union"} {
		f.Add(key)
	}
	f.Fuzz(func(t *testing.T, key string) {
		toolsGuard(t, "FuzzCatchBindingAnnotationKinds", func() {
			TestCatchBindingAnnotationKindsQuoted(t)
			if strings.HasPrefix(key, "legacy-") {
				source := "export effect function main(){try {throw 1} catch(e:number){return 0}}"
				if key == "legacy-record" {
					source = "export effect function main(){try {throw {code:1}} catch({code}:{code:number}){return code}}"
				}
				if key == "legacy-union" {
					source = "error Missing;export effect function main(){try {throw new Missing()} catch(e:Missing|{code:number}){return 0}}"
				}
				r := toolsCompile(t, w, "FuzzCatchBindingAnnotationKinds", map[string]string{"main.vibe": source})
				defer r.Remove()
				errors, warnings, statements := 0, 0, 0
				for _, d := range r.Diagnostics {
					if IsEK(d) && d.Code() == 2105 && d.Category().Name() == "error" {
						errors++
						continue
					}
					if IsEK(d) && d.Code() == 2112 && d.Category().Name() == "warning" {
						warnings++
						continue
					}
					// A JavaScript try statement in effect code is also rejected
					// independently of its legacy binding annotation.
					if IsEK(d) && d.Code() == 503 && d.Category().Name() == "error" {
						statements++
						continue
					}
					if d.Category().Name() == "error" {
						t.Fatalf("unexpected diagnostic: %v", d)
					}
				}
				if errors != 1 || warnings != 1 || statements != 1 {
					t.Fatalf("legacy binding lost its error/warning pair: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
				}
				return
			}
			patterns := map[string]string{"identifier-any": "failure: any", "destructured-any": "{code=1}: any", "rest-any": "{code=1,...other}: any", "renamed-any": "{code:failure=1}: any", "array-any": "[code=1]: any", "unicode-any": "{code:値=1}: any", "identifier-unknown": "failure: unknown"}
			pattern, ok := patterns[key]
			if !ok {
				pattern = patterns["destructured-any"]
			}
			source := fmt.Sprintf("declare function work():void;export function recover():number {try{work()}catch(%s){return 1}return 0}", pattern)
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: catchBindingConfig})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if HasError(r.Diagnostics) {
				t.Fatalf("native catch rejected: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
			}
			want := stockDeclaration(t, w, tsc, Project{Files: map[string]string{"main.ts": source}, Config: catchBindingConfig}, "out/main.d.ts")
			if diff := compareDeclarationTexts(t, want, r.Outputs["out/main.d.ts"]); diff != "" {
				t.Fatal(diff)
			}
			native, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": source}, Config: catchBindingConfig})
			if err != nil {
				t.Fatal(err)
			}
			defer native.Remove()
			ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
			defer cancel()
			if err := os.RemoveAll(filepath.Join(native.Dir, "out")); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
			cmd.Dir = native.Dir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("stock tsc rejected native catch: %v: %s", err, out)
			}
			stockJS, err := os.ReadFile(filepath.Join(native.Dir, "out/main.js"))
			if err != nil {
				t.Fatal(err)
			}
			if HasError(native.Diagnostics) || len(stockJS) == 0 || string(stockJS) != native.Outputs["out/main.js"] || string(stockJS) != r.Outputs["out/main.js"] {
				t.Fatal("plain catch JavaScript differs from its native counterpart")
			}
		})
	})
}

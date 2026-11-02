package vibelangfuzz

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-9's type-only own-member hook also applies in local service bodies.
// Chapter 5's no-namespace rule still rejects S.Shape outside that body.
// The native counterpart writes the private recursive alias directly.
const localServiceShapeVIP = "Inside that service's own shape, `S.Shape` denotes that alias directly, so recursive members do not project through the not-yet-constructed `typeof S`."
const localServiceShapeChapter = "Elsewhere `Users.Shape` is not declared; write `Context.Service.Shape<typeof Users>`:"
const localServiceShapeTarget = "FuzzReviewLocalServiceShape"

var localServiceShapeHomes = []string{"module", "namespace", "block", "function", "arrow", "method", "effect"}
var localServiceShapeForms = []string{"own-property", "own-method", "outside", "projection"}
var localServiceShapeNames = []string{"Node", "Users"}

func localServiceShapeQuotes(tb testing.TB) {
	tb.Helper()
	for chapter, quote := range map[string]string{
		"../vips/0009-service-declarations.md": localServiceShapeVIP,
		"005-services.md":                      localServiceShapeChapter,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			tb.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
	if !strings.Contains(SpecText("005-services.md"), "Private helper names are hygienic, including in declaration output") {
		tb.Fatal("Chapter5 private-helper hygiene rule moved")
	}
}
func TestReviewLocalServiceShapeQuoted(t *testing.T) { localServiceShapeQuotes(t) }

// The key is stable across additions to the lists. Names also collide with
// the compiler's usual private helper spelling, to check alias hygiene.
func FuzzReviewLocalServiceShape(f *testing.F) {
	startShortBudget(f)
	localServiceShapeQuotes(f)
	w := NewWorkspace(f)
	expected := localServiceShapeNativeControls(f, w, StockTypeScript(f))
	for _, home := range localServiceShapeHomes {
		for _, form := range localServiceShapeForms {
			for _, name := range localServiceShapeNames {
				f.Add([]byte(home + ":" + form + ":" + name))
			}
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		pick := func(choices []string, i int) string {
			parts := strings.Split(string(data), ":")
			if i < len(parts) && slices.Contains(choices, parts[i]) {
				return parts[i]
			}
			if i < len(data) {
				return choices[int(data[i])%len(choices)]
			}
			return choices[0]
		}
		home, form, name := pick(localServiceShapeHomes, 0), pick(localServiceShapeForms, 1), pick(localServiceShapeNames, 2)
		key := "feature:" + home + ":" + form + ":" + name
		native := localServiceShapeProgram(home, form, name, true)
		want := expected[home+":"+form+":"+name]
		source := localServiceShapeProgram(home, form, name, false)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := localServiceShapeCodes(result)
		g := &Gaps{Target: localServiceShapeTarget}
		if !slices.Equal(want, got) {
			g.Add(key, "VIP-9: %q; chapter 5: %q; stock %v, Vibe %v\n%s\n--- native\n%s", localServiceShapeVIP, localServiceShapeChapter, want, got, source, native)
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}

// Check the entire finite native neighbourhood in one TypeScript program.
// Each file is a separate module. Loading Effect once keeps the short corpus
// within its CPU budget; no positive or negative counterpart is sampled out.
func localServiceShapeCodes(result *Result) []string {
	var codes []string
	for _, d := range result.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		source := d.Source()
		if source == "" {
			source = "TS"
		} // Native diagnostics omit the optional source field.
		codes = append(codes, source+strconv.Itoa(int(d.Code())))
	}
	slices.Sort(codes)
	return codes
}

func localServiceShapeNativeControls(tb testing.TB, w *Workspace, tsc string) map[string][]string {
	tb.Helper()
	files := map[string]string{}
	expected := map[string][]string{}
	keys := map[string]string{}
	for _, home := range localServiceShapeHomes {
		for _, form := range localServiceShapeForms {
			for _, name := range localServiceShapeNames {
				key := home + ":" + form + ":" + name
				file := "native-" + home + "-" + form + "-" + name + ".ts"
				files[file] = localServiceShapeProgram(home, form, name, true)
				keys[file] = key
				expected[key] = nil
				if form == "outside" && home != "module" && home != "namespace" {
					expected[key] = []string{"TS2702"}
				}
			}
		}
	}
	dir, err := w.writeProject(Project{Files: files})
	if err != nil {
		tb.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(tb.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	output, runErr := cmd.CombinedOutput()
	if ctx.Err() != nil {
		tb.Fatalf("native counterparts did not finish: %v", ctx.Err())
	}
	if runErr != nil {
		exit, ok := runErr.(*exec.ExitError)
		if !ok || exit.ExitCode() != 1 && exit.ExitCode() != 2 {
			tb.Fatalf("native compiler did not complete: %v\n%s", runErr, output)
		}
	}
	got := map[string][]string{}
	for _, line := range strings.Split(string(output), "\n") {
		if m := stockDiagnostic.FindStringSubmatch(line); m != nil {
			key, ok := keys[filepath.Base(m[1])]
			if !ok {
				tb.Fatalf("native diagnostic outside its counterpart: %s", line)
			}
			got[key] = append(got[key], "TS"+m[5])
		}
	}
	for key, want := range expected {
		slices.Sort(got[key])
		if !slices.Equal(got[key], want) {
			tb.Fatalf("native counterpart %s: want %v got %v\n%s", key, want, got[key], output)
		}
	}
	if runErr == nil {
		tb.Fatal("the native local-namespace negative controls were not rejected")
	}
	// The fork's ordinary TypeScript path must report the same native code;
	// this also guards the optional-empty diagnostic source field.
	nativeProbe := localServiceShapeProgram("function", "outside", "Node", true)
	probe, err := w.Compile(tb.Context(), Project{Files: map[string]string{"main.ts": nativeProbe}})
	if err != nil {
		tb.Fatal(err)
	}
	defer probe.Remove()
	if codes := localServiceShapeCodes(probe); !slices.Equal(codes, []string{"TS2702"}) {
		tb.Fatalf("native diagnostic code control: want TS2702, got %v", codes)
	}
	tb.Logf("stock TypeScript controls: %d files, 46 positive and 10 exact TS2702 negative", len(files))
	return expected
}

func localServiceShapeProgram(home, form, name string, native bool) string {
	shape := "next?: " + name + ".Shape"
	if form == "own-method" {
		shape = "next(): " + name + ".Shape"
	}
	if form == "outside" || form == "projection" {
		shape = "value: number"
	}
	body := "const collision = 1;\n"
	if name == "Node" {
		body = "type $Node$Shape = { readonly sentinel: true }; const collision: $Node$Shape = { sentinel: true };\n"
	}
	if native {
		shape = strings.ReplaceAll(shape, name+".Shape", "WrittenShape")
		body += "type WrittenShape = { " + shape + " };\nclass " + name + " extends Context.Service<" + name + ",WrittenShape>()(" + strconv.Quote("local/"+name) + ") {}\n"
		if home == "module" || home == "namespace" {
			body += "declare namespace " + name + " { export type Shape = WrittenShape }\n"
		}
	} else {
		body += "service " + name + " { static readonly key = " + strconv.Quote("local/"+name) + "; " + shape + " }\n"
	}
	if form == "outside" {
		body += "type Outside = " + name + ".Shape;\n"
	}
	if form == "projection" {
		body += "const implementation: Context.Service.Shape<typeof " + name + "> = { value: 1 }; void implementation;\n"
	}
	body += "void collision;\n"
	switch home {
	case "module":
		body += "\nexport {}"
	case "namespace":
		body = "namespace Local {\n" + body + "}\nexport {}"
	case "block":
		body = "{\n" + body + "}\nexport {}"
	case "function":
		body = "export function holder() {\n" + body + "return 0 }"
	case "arrow":
		body = "export const holder = () => {\n" + body + "return 0 }"
	case "method":
		body = "export const holder = { run() {\n" + body + "return 0 } }"
	case "effect":
		if native {
			body = "export const holder = Effect.gen(function* () {\n" + body + "return 0 })"
		} else {
			body = "export const holder = effect {\n" + body + "return 0 }"
		}
	}
	imports := "import { Context, Effect } from \"effect\";\n"
	return imports + body + "\n"
}

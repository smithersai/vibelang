package vibelangfuzz

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzModuleBodyDirectives checks @ts-expect-error and @ts-ignore comments
// in a module body against the same body in its sibling TypeScript file.
//
// Chapter 1, Module declarations: a body "is a TypeScript file stored in the
// `.vibe` file: moving it to a sibling `.ts` file (`.tsx` for a body in
// `.vibex`) with its external-module classification preserved and replacing
// `from name` with that file's specifier changes no diagnostic". So a
// directive suppresses in the body what it suppresses in the sibling, and is
// reported unused (TS2578) only where the sibling's is. Each cell compiles
// the .vibe file and its twin and compares the error codes on each line of
// the body. The alchemy StateStore witness wrote @ts-expect-error over a call
// that still fails, and the body reported it unused.
const bodyDirectiveTarget = "FuzzModuleBodyDirectives"

const bodyDirectiveQuote = "with its external-module classification preserved and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation."

func TestModuleBodyDirectivesQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", bodyDirectiveQuote)
}

var bodyDirectives = map[string]string{
	"expect-error":        "// @ts-expect-error",
	"expect-error-reason": "// @ts-expect-error - TODO",
	"expect-error-block":  "/* @ts-expect-error */",
	"ignore":              "// @ts-ignore",
	"ignore-reason":       "// @ts-ignore: kept",
}

// The statement after the directive. none has no error, so an
// @ts-expect-error over it is unused in both files.
var bodyDirectiveErrors = map[string]string{
	"assign":   `const n: number = "s"`,
	"property": "const m = ({ a: 1 }).b",
	"call":     "const p = parseInt()",
	"return":   `return "s"`,
	"none":     "const ok = 1",
}

// Where the directive and its statement sit in the body; %s is the two
// lines. A return statement needs a function, so top takes no return.
var bodyDirectivePositions = map[string]string{
	"arrow":    "export const a = (x: number): number => {\n%s\n  return x\n}\n",
	"function": "export function a(x: number): number {\n%s\n  return x\n}\n",
	"top":      "%s\nexport const a = (x: number): number => x\n",
	"method":   "export class K {\n  m(x: number): number {\n%s\n    return x\n  }\n}\nexport const a = (x: number): number => new K().m(x)\n",
	"nested":   "export const a = (x: number): number => {\n  const inner = (): number => {\n%s\n    return 0\n  }\n  return inner() + x\n}\n",
	"twice":    "export const a = (x: number): number => {\n%s\n%s\n  return x\n}\n",
}

type bodyDirectiveCase struct {
	directive, err, position string
	vibex                    bool
}

func (c bodyDirectiveCase) key() string {
	ext := "vibe"
	if c.vibex {
		ext = "vibex"
	}
	return c.directive + "/" + c.err + "/" + c.position + "/" + ext
}

func (c bodyDirectiveCase) valid() bool {
	return c.position != "top" || c.err != "return"
}

// body is the body text; its first line is line 2 of the .vibe file and
// line 1 of the twin.
func (c bodyDirectiveCase) body() string {
	lines := "  " + bodyDirectives[c.directive] + "\n  " + bodyDirectiveErrors[c.err]
	return strings.ReplaceAll(bodyDirectivePositions[c.position], "%s", lines)
}

// files is the project: main with the body, or main importing its twin.
func (c bodyDirectiveCase) files(twin bool) (map[string]string, string) {
	ext, tsExt := ".vibe", ".ts"
	if c.vibex {
		ext, tsExt = ".vibex", ".tsx"
	}
	files := map[string]string{"package.json": `{"type":"module"}`}
	use := "export const g = (x: number): number => a(x)\n"
	if twin {
		files["main"+ext] = "import { a } from \"./helpers.js\"\n" + use
		files["helpers"+tsExt] = c.body()
		return files, "helpers" + tsExt
	}
	files["main"+ext] = "module helpers {\n" + c.body() + "}\nimport { a } from helpers\n" + use
	return files, "main" + ext
}

func bodyDirectiveCases() []bodyDirectiveCase {
	var cases []bodyDirectiveCase
	for _, d := range slices.Sorted(maps.Keys(bodyDirectives)) {
		for _, e := range slices.Sorted(maps.Keys(bodyDirectiveErrors)) {
			for _, p := range slices.Sorted(maps.Keys(bodyDirectivePositions)) {
				for _, vibex := range []bool{false, true} {
					if c := (bodyDirectiveCase{d, e, p, vibex}); c.valid() {
						cases = append(cases, c)
					}
				}
			}
		}
	}
	return cases
}

// bodyDirectiveErrorsByLine returns the error codes of a compilation, each
// as "TS<code>@<line of the body>" for the body's file and "TS<code>@main"
// elsewhere, sorted.
func bodyDirectiveErrorsByLine(t *testing.T, w *Workspace, files map[string]string, bodyFile string, offset int) []string {
	t.Helper()
	project := Project{Files: files}
	for name := range files {
		// The default files list names no .vibex; list every source instead.
		if strings.HasSuffix(name, ".vibex") {
			project.Config = strings.Replace(DefaultConfig, `"target":`, `"jsx": "preserve", "target":`, 1)
		}
	}
	r, err := w.Compile(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	var got []string
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		code := fmt.Sprintf("TS%d", d.Code())
		if IsEK(d) {
			code = fmt.Sprintf("EK%04d", d.Code())
		}
		where := "main"
		if d.File() != nil && strings.HasSuffix(string(d.File().FileName()), "/"+bodyFile) {
			line := strings.Count(d.File().Text()[:d.Pos()], "\n") + 1 - offset
			where = fmt.Sprint(line)
		}
		got = append(got, code+"@"+where)
	}
	slices.Sort(got)
	return got
}

func bodyDirectiveCompare(t *testing.T, w *Workspace, c bodyDirectiveCase, gap string) {
	t.Helper()
	vibeFiles, vibeBody := c.files(false)
	twinFiles, twinBody := c.files(true)
	got := bodyDirectiveErrorsByLine(t, w, vibeFiles, vibeBody, 1)
	want := bodyDirectiveErrorsByLine(t, w, twinFiles, twinBody, 0)
	if !slices.Equal(got, want) {
		Gap(t, bodyDirectiveTarget, gap, "%s: the body reports %v, its sibling %s reports %v\n%s", bodyDirectiveQuote, got, twinBody, want, vibeFiles[vibeBody])
	}
	ExpectPending(t, bodyDirectiveTarget, gap)
}

// The gap key leaves out the position and the file kind: a directive's
// meaning does not depend on either.
func (c bodyDirectiveCase) gapKey() string { return c.directive + "/" + c.err }

func FuzzModuleBodyDirectives(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "001-functions.md", bodyDirectiveQuote)
	cases := bodyDirectiveCases()
	keys := make([]string, len(cases))
	for i, c := range cases {
		keys[i] = c.key()
	}
	// One cell for each directive and statement, the position and file
	// kind turning with them; the matrix test runs every cell.
	positions := slices.Sorted(maps.Keys(bodyDirectivePositions))
	i := 0
	for _, d := range slices.Sorted(maps.Keys(bodyDirectives)) {
		for _, e := range slices.Sorted(maps.Keys(bodyDirectiveErrors)) {
			c := bodyDirectiveCase{d, e, positions[i%len(positions)], i%2 == 1}
			if !c.valid() {
				c.position = "arrow"
			}
			f.Add([]byte(c.key()))
			i++
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		c := cases[choice]
		bodyDirectiveCompare(t, w, c, c.gapKey())
		ExpectPending(t, bodyDirectiveTarget, specCorpusKey(t))
	})
}

func TestModuleBodyDirectivesMatrix(t *testing.T) {
	SkipShortMatrix(t, bodyDirectiveTarget, "VIBELANG_BODY_DIRECTIVES_MATRIX", "the complete directive, statement, position and file-kind matrix runs separately")
	TestModuleBodyDirectivesQuoted(t)
	w := NewWorkspace(t)
	for _, c := range bodyDirectiveCases() {
		t.Run(c.key(), func(t *testing.T) { bodyDirectiveCompare(t, w, c, c.gapKey()) })
	}
}

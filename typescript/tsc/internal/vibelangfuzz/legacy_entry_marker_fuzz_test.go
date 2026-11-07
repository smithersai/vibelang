package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 7, Legacy entry-dispatch migration.
var legacyEntryMarkerQuotes = []string{
	"`EK2601` rejects the retired side-effect markers `vibelang/platform/node`, `vibelang/platform/bun` and `vibelang/platform/browser`, even without `main`",
	"An eligible legacy startup is an exported, non-default, zero-parameter function declaration `main` with a body and no checker-resolved top-level runner call under the pinned legacy compiler and options.",
	"Without eligible startup, remove only the inert marker and keep any explicit runner.",
	"Preserve entry-only execution and import-only behavior.",
	"keep the marker and report its file, line and reason as not fixed, with a nonzero exit.",
	"A remaining marker keeps `EK2601`; `main` alone is ordinary source, gets no entry diagnostic and causes no implicit startup",
}

func TestLegacyEntryMarkerQuoted(t *testing.T) {
	for _, quote := range legacyEntryMarkerQuotes {
		chapterSays(t, "007-tooling.md", quote)
	}
}

// A legacy entry marker module: its body, and whether the body is an
// eligible legacy startup.
var legacyEntryBodies = []struct {
	key, body string
	eligible  bool
}{
	{"no-main", "export const value = 1", false},
	{"effect-main", "export effect function main() { return 1 }", true},
	{"plain-main", "export function main(): number { return 1 }", true},
	{"async-main", "export async function main() { return 1 }", true},
	{"default-main", "export default function main() { return 1 }", false},
	{"parameter-main", "export function main(value: number) { return value }", false},
	{"arrow-main", "export const main = () => 1", false},
	{"unexported-main", "function main() { return 1 }\nexport const program = main", false},
	{"runner-main", "export effect function main() { return 1 }\nEffect.runFork(main())", false},
	{"local-runner-main", "const helper = { runMain(value: number) { return value } }\nhelper.runMain(1)\nexport effect function main() { return 1 }", true},
	{"delayed-runner-main", "export effect function main() { return 1 }\nexport const start = () => Effect.runFork(main())", true},
}

var legacyEntryPlatforms = []string{"node", "bun", "browser"}

// FuzzLegacyEntryMarker checks every retired marker against chapter 7: the
// compiler reports EK2601 at it and emits no dispatcher, and vibelang --fix
// removes only an inert marker and refuses an eligible startup, keeping its
// marker and naming its line. The input is `<platform>:<body>`, or bytes
// that pick both.
func FuzzLegacyEntryMarker(f *testing.F) {
	startShortBudget(f)
	for _, platform := range legacyEntryPlatforms {
		for _, body := range legacyEntryBodies {
			f.Add(platform+":"+body.key, uint8(0))
		}
	}
	f.Add("node:no-main", uint8(1))
	f.Add("browser:effect-main", uint8(2))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, input string, variant uint8) {
		TestLegacyEntryMarkerQuoted(t)
		platform, bodyKey, _ := strings.Cut(input, ":")
		body := legacyEntryBodies[len(input)%len(legacyEntryBodies)]
		for _, candidate := range legacyEntryBodies {
			if candidate.key == bodyKey {
				body = candidate
			}
		}
		if !strings.Contains(strings.Join(legacyEntryPlatforms, " "), platform) || platform == "" {
			platform = legacyEntryPlatforms[int(variant)%len(legacyEntryPlatforms)]
		}
		key := platform + ":" + body.key
		marker := "import \"vibelang/platform/" + platform + "\""
		prefix := ""
		if variant&1 != 0 {
			prefix = "// a comment before the marker\n"
		}
		suffix := "\n"
		if variant&2 != 0 {
			suffix = ";\n" // the marker statement ends with a semicolon
		}
		source := prefix + marker + suffix + "\n" + body.body + "\n"
		markerLine := strings.Count(prefix, "\n") + 1
		r := toolsCompile(t, w, "FuzzLegacyEntryMarker", map[string]string{"main.vibe": source})
		defer r.Remove()
		var lines []int
		for _, d := range r.Diagnostics {
			if IsEK(d) && d.Code() == 2601 && d.File() != nil {
				lines = append(lines, strings.Count(d.File().Text()[:d.Pos()], "\n")+1)
			}
		}
		if len(lines) != 1 || lines[0] != markerLine {
			Gap(t, "FuzzLegacyEntryMarker", "diagnostic:"+key, "%s: want one EK2601 on line %d, got lines %v in\n%s", legacyEntryMarkerQuotes[0], markerLine, lines, source)
		}
		for name, output := range r.Outputs {
			if strings.HasSuffix(name, ".js") && (strings.Contains(output, "$entry") || strings.Contains(output, "vibelang/platform")) {
				Gap(t, "FuzzLegacyEntryMarker", "startup:"+key, "%s: %s emitted\n%s", legacyEntryMarkerQuotes[5], name, output)
			}
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, r.Dir), vibelang.FixOptions{})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		var text string
		for name, file := range fixed.Files {
			if strings.HasSuffix(string(name), "/main.vibe") {
				text = file.Text
			}
		}
		var refusals []vibelang.FixRefusal
		for _, refusal := range fixed.Refused {
			if refusal.Reason != "" {
				refusals = append(refusals, refusal)
			}
		}
		if body.eligible {
			if text != "" || len(refusals) != 1 || !strings.HasSuffix(string(refusals[0].File), "/main.vibe") || refusals[0].Line != markerLine || refusals[0].Code != 2601 {
				Gap(t, "FuzzLegacyEntryMarker", "refusal:"+key, "%s %s: --fix wrote %q and refused %+v for\n%s", legacyEntryMarkerQuotes[3], legacyEntryMarkerQuotes[4], text, refusals, source)
			}
		} else {
			want := prefix + "\n" + body.body + "\n"
			if text != want || len(refusals) != 0 {
				Gap(t, "FuzzLegacyEntryMarker", "inert:"+key, "%s: --fix wrote\n%s\nwant\n%s\nrefused %+v", legacyEntryMarkerQuotes[2], text, want, refusals)
			}
		}
		ExpectPending(t, "FuzzLegacyEntryMarker", key)
	})
}

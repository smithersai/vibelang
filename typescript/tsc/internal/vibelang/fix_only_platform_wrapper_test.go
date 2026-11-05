package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A platform-wrapper repair needs a new sibling TypeScript module. Under
// --only it is refused at its site while independent listed-file repairs
// remain valid. A per-site explanation may name the omitted companion;
// it does not mean the whole scoped run failed or wrote nothing.
var onlyPlatformWrappers = []string{
	"Effect.try(() => window.location.origin)",
	"Effect.try(() => performance.now())",
	"Effect.try({ try: () => window.location.origin, catch: (e) => e })",
	"sync(() => document.title)",
	"Effect.sync(() => document.title)",
	"Effect.tryPromise(async () => document.title)",
}

func onlyWrapperModule(wrapper, name string) string {
	return "export effect function " + name + "() { return try " + wrapper + "; }\n"
}

func TestFixOnlyRefusesPlatformWrapperFile(t *testing.T) {
	for _, wrapper := range onlyPlatformWrappers {
		for _, place := range []string{"listed", "unlisted", "both"} {
			t.Run(place+"/"+wrapper, func(t *testing.T) {
				files := map[string]string{"a.vibe": onlyFixableA, "b.vibe": "export const b = 1\n"}
				if place != "unlisted" {
					files["a.vibe"] = onlyFixableA + onlyWrapperModule(wrapper, "probeA")
				}
				if place != "listed" {
					files["b.vibe"] = onlyWrapperModule(wrapper, "probeB")
				}
				dir := onlyProject(t, files)
				before := projectBytes(t, dir)
				status, sys := runFix(t, dir, "--only", "a.vibe")
				out := sys.stdout.String() + sys.stderr.String()
				if status == 3 || strings.Contains(out, "wrote nothing") {
					t.Fatalf("--only a.vibe: status %d, wrote nothing:\n%s", status, out)
				}
				if place != "unlisted" && (!strings.Contains(out, "not fixed") || !strings.Contains(out, "partial repair")) {
					t.Fatalf("scoped wrapper refusal lost its per-site or partial-project explanation:\n%s", out)
				}
				after := projectBytes(t, dir)
				expectChanged(t, before, after, "a.vibe")
				if strings.Contains(after["a.vibe"], "Effect.Effect<number>") {
					t.Fatalf("a.vibe lost its other fix:\n%s", after["a.vibe"])
				}
				if strings.Contains(after["a.vibe"], "$platform") || strings.Contains(after["a.vibe"], ".platform") {
					t.Fatalf("a.vibe moved its wrapper out under --only:\n%s", after["a.vibe"])
				}
				matches, _ := filepath.Glob(filepath.Join(dir, "*.platform*.ts"))
				if len(matches) != 0 {
					t.Fatalf("--only wrote %v", matches)
				}
			})
		}
	}
}

// Plain --fix still moves the Alchemy wrapper into its new TypeScript file.
func TestFixPlatformWrapperAlchemyCorpusWithoutOnly(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("testdata", "only-platform-wrapper", "alchemy-neon-function-bridge.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	dir := onlyProject(t, map[string]string{"a.vibe": string(source)})
	status, plain := runFix(t, dir)
	if matches, _ := filepath.Glob(filepath.Join(dir, "a.platform*.ts")); status != 0 || len(matches) != 1 || filepath.Base(matches[0]) != "a.platform.ts" {
		t.Fatalf("plain --fix: status %d, wrote %v, want exactly a.platform.ts\n%s%s\n%s", status, matches, plain.stdout.String(), plain.stderr.String(), projectBytes(t, dir)["a.vibe"])
	}
	only := onlyProject(t, map[string]string{"a.vibe": string(source)})
	status, sys := runFix(t, only, "--only", "a.vibe")
	if status == 3 || strings.Contains(sys.stderr.String(), "wrote nothing") {
		t.Fatalf("--only on the Alchemy corpus: status %d\n%s", status, sys.stderr.String())
	}
}

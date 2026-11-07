package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// A platform-wrapper repair moves the wrapper into a new sibling TypeScript
// module. Chapter 7: under --only, that fresh companion of a listed module is
// part of the module's repair; an unlisted module's companion is never
// written, and neither is a file that already claims the name.
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

// companions returns the platform companions in dir, by base name.
func companions(t *testing.T, dir string) []string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, "*.platform*.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for i, match := range matches {
		matches[i] = filepath.Base(match)
	}
	return matches
}

func TestFixOnlyPlatformWrapperCompanion(t *testing.T) {
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
				if !strings.Contains(out, "partial repair") {
					t.Fatalf("scoped run lost its partial-project explanation:\n%s", out)
				}
				after := projectBytes(t, dir)
				if strings.Contains(after["a.vibe"], "Effect.Effect<number>") {
					t.Fatalf("a.vibe lost its other fix:\n%s", after["a.vibe"])
				}
				if place == "unlisted" {
					expectChanged(t, before, after, "a.vibe")
					if got := companions(t, dir); len(got) != 0 {
						t.Fatalf("--only a.vibe wrote %v for unlisted b.vibe", got)
					}
					return
				}
				expectChanged(t, before, after, "a.vibe", "a.platform.ts")
				if !strings.Contains(after["a.vibe"], "$platform") || !strings.HasPrefix(after["a.platform.ts"], platformCompanionMarker) {
					t.Fatalf("a.vibe kept its wrapper under --only:\n%s\n%s", after["a.vibe"], out)
				}
				// The listed module's repair is the one plain --fix makes.
				plain := onlyProject(t, map[string]string{"a.vibe": files["a.vibe"], "b.vibe": "export const b = 1\n"})
				if status, sys := runFix(t, plain); status != 0 {
					t.Fatalf("plain --fix: status %d\n%s%s", status, sys.stdout.String(), sys.stderr.String())
				}
				want := projectBytes(t, plain)
				for _, name := range []string{"a.vibe", "a.platform.ts"} {
					if after[name] != want[name] {
						t.Fatalf("%s under --only:\n%s\nplain --fix:\n%s", name, after[name], want[name])
					}
				}
			})
		}
	}
}

// A file that claims the companion's name is never written, with or without
// --only, and the listed module keeps its wrapper.
func TestFixOnlyPlatformWrapperClaimedCompanion(t *testing.T) {
	for _, claimed := range []string{"a.platform.ts", "a.platform.tsx", "a.platform.js", "a.platform.d.ts"} {
		t.Run(claimed, func(t *testing.T) {
			text := "export const taken = 1\n"
			dir := onlyProject(t, map[string]string{"a.vibe": onlyWrapperModule("Effect.sync(() => document.title)", "probeA"), claimed: text})
			status, sys := runFix(t, dir, "--only", "a.vibe")
			out := sys.stdout.String() + sys.stderr.String()
			if status == 3 || strings.Contains(out, "wrote nothing") {
				t.Fatalf("status %d:\n%s", status, out)
			}
			after := projectBytes(t, dir)
			if after[claimed] != text {
				t.Fatalf("--only rewrote %s:\n%s", claimed, after[claimed])
			}
			var want []string
			if strings.HasSuffix(claimed, ".ts") {
				want = []string{claimed}
			}
			if got := companions(t, dir); !sameNames(got, want) {
				t.Fatalf("--only wrote a companion beside %s: %v", claimed, got)
			}
			if strings.Contains(after["a.vibe"], "$platform") {
				t.Fatalf("a.vibe moved its wrapper beside %s:\n%s", claimed, after["a.vibe"])
			}
		})
	}
}

// The Alchemy corpus: --only makes the repair plain --fix makes.
func TestFixPlatformWrapperAlchemyCorpus(t *testing.T) {
	for _, corpus := range []string{"alchemy-neon-function-bridge.vibe", "alchemy-exported-platform-value.vibe"} {
		t.Run(corpus, func(t *testing.T) {
			source, err := os.ReadFile(filepath.Join("testdata", "only-platform-wrapper", corpus))
			if err != nil {
				t.Fatal(err)
			}
			plain := onlyProject(t, map[string]string{"a.vibe": string(source)})
			status, sys := runFix(t, plain)
			if got := companions(t, plain); status != 0 || len(got) != 1 || got[0] != "a.platform.ts" {
				t.Fatalf("plain --fix: status %d, wrote %v, want exactly a.platform.ts\n%s%s\n%s", status, got, sys.stdout.String(), sys.stderr.String(), projectBytes(t, plain)["a.vibe"])
			}
			only := onlyProject(t, map[string]string{"a.vibe": string(source)})
			status, sys = runFix(t, only, "--only", "a.vibe")
			out := sys.stdout.String() + sys.stderr.String()
			if status != 0 || strings.Contains(out, "wrote nothing") || strings.Contains(out, "does not list") {
				t.Fatalf("--only on the Alchemy corpus: status %d\n%s", status, out)
			}
			got, want := projectBytes(t, only), projectBytes(t, plain)
			for _, name := range []string{"a.vibe", "a.platform.ts"} {
				if got[name] != want[name] {
					t.Fatalf("%s under --only:\n%s\nplain --fix:\n%s", name, got[name], want[name])
				}
			}
			// Before the companion was in scope, EK4834 rewrote the refused
			// wrapper into an effect block that no fix repairs.
			if strings.Contains(got["a.vibe"], "effect {") {
				t.Fatalf("--only left the host read in an effect block:\n%s", got["a.vibe"])
			}
		})
	}
}

// A companion is in scope only while no file claims its name. A file that
// appears after the run began is unlisted, and the keeper never edits it.
func TestFixKeeperRefusesACompanionThatAppeared(t *testing.T) {
	dir := onlyProject(t, map[string]string{"a.vibe": onlyWrapperModule("Effect.sync(() => document.title)", "probeA")})
	name := func(base string) tspath.RootedFilePath {
		return tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, base)))
	}
	sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
	stopped := false
	keeper := &fixKeeper{sys: sys, scope: newFixScope(sys.fs, []tspath.RootedFilePath{name("a.vibe")}), stop: func() { stopped = true }, last: map[tspath.RootedFilePath]string{}, original: map[tspath.RootedFilePath]string{}}
	if !keeper.scope.companion(name("a.platform.ts")) {
		t.Fatal("a.platform.ts is not the listed module's fresh companion")
	}
	const other = "export const written = 'by someone else'\n"
	if err := os.WriteFile(filepath.Join(dir, "a.platform.ts"), []byte(other), 0o600); err != nil {
		t.Fatal(err)
	}
	keeper.keep(map[tspath.RootedFilePath]string{name("a.platform.ts"): platformCompanionMarker + "export function $platform() {}\n"})
	if keeper.err == nil || !stopped {
		t.Fatalf("err %v, stopped %v; want the run stopped", keeper.err, stopped)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "a.platform.ts")); string(got) != other {
		t.Fatalf("the keeper edited an unlisted file:\n%s", got)
	}
}

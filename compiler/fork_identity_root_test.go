package compiler

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The defect this file exists for.
//
// On 2026-08-28 the Go fork derived a root's logical name by making it relative
// to `os.Getwd()`. Compiling ONE file from two directories therefore minted two
// different `flowId`s, two Action `id`s, two `contractDigest`s, two
// `plan.digest`s, two Effect Manifest digests and two sets of nominal failure
// identities for byte-identical source. Measured, before the fix, on the same
// program staged in two checkouts:
//
//	cwd .../stage/co-a  ->  flowId app/flow.sm#Flow
//	                        contractDigest c0e33a87…  plan.digest c6189fcd…
//	cwd .../stage       ->  flowId co-a/app/flow.sm#Flow
//	                        contractDigest f272d3ac…  plan.digest ac8dae0b…
//	cwd .../stage  (checkout co-b-different-name)
//	                    ->  flowId co-b-different-name/app/flow.sm#Flow
//	                        contractDigest 13e3e5d7…  plan.digest e82fcfd7…
//
// The digests agreed between the two backends and disagreed between two
// terminals, which is the opposite of what a signable artifact needs. No test
// existed on that path at all — `hydrateCompileRequest`'s disk branch is skipped
// whenever `Files` is supplied, which is what the conformance runner and every
// editor host do, so the whole suite could be green with the CLI minting
// per-directory identities.
//
// These tests are written against the shape of the mistake rather than the line:
// the first two pin the rule, `TestForkIdentityPathIsNotAllowedToReachTheWorkingDirectory`
// makes reintroducing `os.Getwd` a build-visible failure, and
// `TestHydrateCompileRequestIdentitiesSurviveTwoCheckoutsAndTwoDirectories`
// reproduces the original measurement end to end without needing the fork.

func TestIdentityPathsForDiskRootsUsesTheStatedProjectRoot(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "checkout", "a")
	names, err := identityPathsForDiskRoots([]string{
		filepath.Join(root, "app", "main.sm"),
		filepath.Join(root, "app", "lib", "util.sm"),
		filepath.Join("app", "shared.ts"),
	}, root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"app/main.sm", "app/lib/util.sm", "app/shared.ts"}
	if !equalStrings(names, want) {
		t.Fatalf("logical names = %v, want %v", names, want)
	}

	// The same names under a DIFFERENT checkout root are byte-identical. That is
	// the property a Manifest digest has to have to be a signature.
	other := filepath.Join(string(filepath.Separator), "elsewhere", "b-with-a-longer-name")
	elsewhere, err := identityPathsForDiskRoots([]string{
		filepath.Join(other, "app", "main.sm"),
		filepath.Join(other, "app", "lib", "util.sm"),
		filepath.Join("app", "shared.ts"),
	}, other)
	if err != nil {
		t.Fatal(err)
	}
	if !equalStrings(elsewhere, want) {
		t.Fatalf("logical names under a second checkout = %v, want %v", elsewhere, want)
	}

	if _, err := identityPathsForDiskRoots(
		[]string{filepath.Join(string(filepath.Separator), "outside", "main.sm")}, root,
	); err == nil {
		t.Fatal("a root outside the stated project root was accepted")
	}
	if _, err := identityPathsForDiskRoots([]string{"main.sm"}, "relative/root"); err == nil {
		t.Fatal("a relative project root was accepted")
	}
	if _, err := identityPathsForDiskRoots([]string{
		filepath.Join(root, "app", "main.sm"),
		filepath.Join("app", "main.sm"),
	}, root); err == nil {
		t.Fatal("two roots naming one logical file were accepted")
	}
}

func TestIdentityPathsForDiskRootsDerivesTheRootFromTheRootNames(t *testing.T) {
	separator := string(filepath.Separator)
	for _, testCase := range []struct {
		name  string
		roots []string
		want  []string
	}{{
		// One absolute root: the derived root is its own directory, so the
		// logical name is the basename — the same rule `identityFileName`
		// (poc/src/language/semantic.ts) uses when it has no root to be
		// relative to.
		name:  "one absolute root",
		roots: []string{filepath.Join(separator, "checkout", "app", "flow.sm")},
		want:  []string{"flow.sm"},
	}, {
		name: "several absolute roots share their deepest common directory",
		roots: []string{
			filepath.Join(separator, "checkout", "app", "main.sm"),
			filepath.Join(separator, "checkout", "app", "lib", "util.sm"),
		},
		want: []string{"main.sm", "lib/util.sm"},
	}, {
		// A sibling directory whose name merely EXTENDS another's must not be
		// read as living beneath it: the ancestor is compared element by
		// element, not as a string prefix.
		name: "app and apple are siblings, not ancestor and descendant",
		roots: []string{
			filepath.Join(separator, "checkout", "app", "main.sm"),
			filepath.Join(separator, "checkout", "apple", "main.sm"),
		},
		want: []string{"app/main.sm", "apple/main.sm"},
	}, {
		// Already logical. Normalized so `./a.sm` and `a.sm` cannot mint two
		// identities for one file, and otherwise left exactly as authored.
		name:  "relative roots are already logical names",
		roots: []string{filepath.Join(".", "app", "main.sm"), "shared.ts"},
		want:  []string{"app/main.sm", "shared.ts"},
	}, {
		name: "absolute roots that diverge at the filesystem root",
		roots: []string{
			filepath.Join(separator, "one", "main.sm"),
			filepath.Join(separator, "two", "util.sm"),
		},
		want: []string{"one/main.sm", "two/util.sm"},
	}} {
		t.Run(testCase.name, func(t *testing.T) {
			names, err := identityPathsForDiskRoots(testCase.roots, "")
			if err != nil {
				t.Fatal(err)
			}
			if !equalStrings(names, testCase.want) {
				t.Fatalf("logical names = %v, want %v", names, testCase.want)
			}
		})
	}

	if _, err := identityPathsForDiskRoots([]string{filepath.Join("..", "escape.sm")}, ""); err == nil {
		t.Fatal("a relative root escaping the project was accepted")
	}
}

// The working directory is not an input to any identity, and this says so by
// running the same derivation from two directories that would have produced
// different answers under the old rule.
func TestIdentityPathsForDiskRootsIgnoreTheWorkingDirectory(t *testing.T) {
	stage := t.TempDir()
	for _, checkout := range []string{"co-a", "co-b-with-a-different-name"} {
		if err := os.MkdirAll(filepath.Join(stage, checkout, "app"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	roots := []string{filepath.Join(stage, "co-a", "app", "flow.sm")}

	answers := make([][]string, 0, 3)
	for _, directory := range []string{stage, filepath.Join(stage, "co-a"), filepath.Join(stage, "co-a", "app")} {
		t.Chdir(directory)
		names, err := identityPathsForDiskRoots(roots, "")
		if err != nil {
			t.Fatal(err)
		}
		answers = append(answers, names)
	}
	for _, answer := range answers {
		if !equalStrings(answer, []string{"flow.sm"}) {
			t.Fatalf("logical names = %v from a different working directory, want [flow.sm] from every one", answer)
		}
	}
}

// The structural half of the fix. Correcting the one call site would leave the
// next author free to reach for the working directory again; deleting it from
// the file means there is nothing to reach for, and this keeps it deleted.
func TestForkIdentityPathIsNotAllowedToReachTheWorkingDirectory(t *testing.T) {
	source, err := os.ReadFile("fork.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(source), "os.Getwd") {
		t.Fatal("fork.go calls os.Getwd; a logical name derived from the working directory is not an identity " +
			"(see identityPathsForDiskRoots). Filesystem I/O against a relative path is fine and needs no Getwd.")
	}
}

// The end-to-end shape of the original measurement, without the pinned fork: the
// bytes `hydrateCompileRequest` hands the bridge are what every identity is
// minted from, so if those agree across two checkouts and three working
// directories, everything downstream of them does too.
func TestHydrateCompileRequestIdentitiesSurviveTwoCheckoutsAndTwoDirectories(t *testing.T) {
	stage := t.TempDir()
	const text = "export const value = 1\n"
	for _, checkout := range []string{"co-a", "co-b-with-a-different-name"} {
		directory := filepath.Join(stage, checkout, "app")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "flow.sm"), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	type observation struct {
		label string
		names []string
		paths []string
	}
	observations := []observation{}
	for _, checkout := range []string{"co-a", "co-b-with-a-different-name"} {
		root := filepath.Join(stage, checkout)
		for _, directory := range []string{stage, root, filepath.Join(root, "app")} {
			for _, statedRoot := range []string{"", root} {
				t.Chdir(directory)
				request, _, err := hydrateCompileRequest(CompileRequest{
					RootNames: []string{filepath.Join(root, "app", "flow.sm")},
					Lowering:  LoweringInternal,
					RootDir:   statedRoot,
				})
				if err != nil {
					t.Fatalf("%s from %s: %v", checkout, directory, err)
				}
				paths := make([]string, 0, len(request.Files))
				for _, file := range request.Files {
					if file.Text != text {
						t.Fatalf("%s: the staged text is not the file's text", checkout)
					}
					paths = append(paths, file.Path)
				}
				label := "derived root"
				if statedRoot != "" {
					label = "stated root"
				}
				observations = append(observations, observation{
					label: label + " / " + checkout + " / cwd " + directory,
					names: request.RootNames,
					paths: paths,
				})
			}
		}
	}

	// Two answers only: one for the derived root and one for the stated root.
	// Never one per working directory, and never one per checkout.
	want := map[string][]string{"derived root": {"flow.sm"}, "stated root": {"app/flow.sm"}}
	for _, seen := range observations {
		expected := want[strings.SplitN(seen.label, " / ", 2)[0]]
		if !equalStrings(seen.names, expected) || !equalStrings(seen.paths, expected) {
			t.Fatalf("%s: root names %v and staged paths %v, want %v for both",
				seen.label, seen.names, seen.paths, expected)
		}
	}
	if len(observations) != 12 {
		t.Fatalf("expected 12 observations, got %d", len(observations))
	}
}

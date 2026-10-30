package vibelangfuzz

import (
	"maps"
	"math/rand/v2"
	"os"
	"slices"
	"strings"
	"testing"
)

const spliceTarget = "FuzzSplice"

// FuzzSplice compiles programs spliced together from real ones
// (splice_mutate_test.go) and holds each to the oracles FuzzParse and
// FuzzCompile hold any input to, under its own target name:
//
//   - No panic and no hang: a panic is a gap keyed by the function that
//     panicked, and a stage that outlasts HangLimit ends the process
//     (Within).
//   - Each spliced .vibe text, parsed as .vibe, .ts, .tsx and .d.ts: every
//     span inside the text (D61, D34), a TypeScript tree whose nodes nest in
//     order (D266), the same tree on every parse, and ESTree that is JSON
//     with ranges inside the text (Chapter 28 Linting, D277). CheckParse
//     holds a text to these.
//   - The project: every EK code registered in Chapter 28 and not retired,
//     in its default category, only in .vibe files (D266), at spans inside
//     their files; the same diagnostics and outputs from a fresh compilation
//     and in every order the checker can be asked (Chapters 27 and 28); and,
//     with no error, every output Chapter 27 requires, with the imports,
//     runtime helpers, source maps (D34) and declarations a consumer
//     type-checks against (D366). CheckCompile holds a project to these.
//
// An input is a choice input, whose bytes choose the recipient and the
// splices, or an archive, which starts with a file marker ("-- main.vibe --")
// and is checked as written: a minimal reproduction of a spliced program's
// failure lives in testdata/fuzz/FuzzSplice as an archive, since the
// program, not the splice that found it, is the bug. Known gaps that another
// target records reach this one too; testdata/pending/splice.txt lists them
// under this target, citing the other target's line.
func FuzzSplice(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, seed := range spliceSeeds() {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		t.Parallel() // the seed corpus only; fuzzing ignores it
		CheckSplice(t, w, input)
	})
}

// spliceSeeds are choice inputs from a fixed generator: twelve with -short,
// so the smoke gate splices each category into a few cases and snippets,
// and forty-eight otherwise.
func spliceSeeds() []string {
	n := 48
	if testing.Short() {
		n = 12
	}
	r := rand.New(rand.NewPCG(5, 8))
	seeds := make([]string, n)
	for i := range seeds {
		input := make([]byte, 48)
		for j := range input {
			input[j] = byte(r.IntN(256))
		}
		seeds[i] = string(input)
	}
	return seeds
}

// CheckSplice runs FuzzSplice's oracles on one input.
//
// It applies parseGaps and compileGaps with one Gaps for the input, so a
// corpus line marks its reproduction for XPASS only when no oracle disagrees.
func CheckSplice(t *testing.T, w *Workspace, input string) {
	var project Project
	var spliced []string // the .vibe files whose text no case or snippet holds
	name := "archive"
	if strings.HasPrefix(input, "-- ") {
		project = ProjectFromArchive(input)
		for file := range project.Files {
			if strings.HasSuffix(file, ".vibe") {
				spliced = append(spliced, file)
			}
		}
		slices.Sort(spliced)
	} else {
		var r spliceRecipient
		var splices []splice
		r, project, splices = spliceProject([]byte(input))
		if len(splices) == 0 {
			t.Skip("no splice: no candidate of the chosen categories is valid")
		}
		var described []string
		for _, s := range splices {
			described = append(described, s.String())
			if !slices.Contains(spliced, s.file) {
				spliced = append(spliced, s.file)
			}
		}
		name = "splice of " + r.name + ": " + strings.Join(described, "; ")
	}
	if reason := Admissible(project); reason != "" {
		t.Skip(reason)
	}
	files := maps.Clone(project.Files)
	if project.Config != "" {
		files["tsconfig.json"] = project.Config
	}
	if os.Getenv("VIBELANG_FUZZ_SPLICE_PRINT") == "1" {
		t.Logf("%s\n%s", name, Archive(files))
	}
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("the spliced project:\n%s", Archive(files))
		}
	})
	g := &Gaps{Target: spliceTarget, Input: name}
	key := ""
	if file := corpusFile(t, spliceTarget); file != "" {
		key = "corpus:" + file
		g.Input = "testdata/fuzz/" + spliceTarget + "/" + file
	}
	entry, pending := Pending(spliceTarget, key)
	if pending && strings.HasPrefix(entry.Reason, "hang") && os.Getenv("VIBELANG_FUZZ_HANG_PROBE") != "1" {
		t.Skipf("pending (%s): %s", entry.Owner, entry.Reason)
	}
	defer recoverCompilerPanic(t, spliceTarget)

	// FuzzParse's oracles (CheckParse) on each spliced text: a splice makes
	// a text no case or snippet holds, which FuzzParse never saw.
	for _, file := range spliced {
		parseGaps(g, project.Files[file])
	}

	// FuzzCompile's oracles (CheckCompile) on the project.
	compileGaps(t, w, g, project, input)
	g.FinishInput(t, key)
}

// TestSpliceMutation checks the splicer itself: an input decides its
// project, so a saved crasher replays; every category has donors and is
// spliced; and each splice puts a valid node of the replaced node's category
// where that node stood.
func TestSpliceMutation(t *testing.T) {
	pool := spliceDonors()
	for c := range spliceCategories {
		t.Logf("%s: %d donor texts", c, len(pool.donors[c]))
		if len(pool.donors[c]) == 0 {
			t.Errorf("no %s donor", c)
		}
	}
	t.Logf("%d recipients", len(spliceRecipients()))
	r := rand.New(rand.NewPCG(13, 21))
	spliced := map[spliceCategory]int{}
	inputs, without, parsing := 300, 0, 0
	for range inputs {
		input := make([]byte, 48)
		for j := range input {
			input[j] = byte(r.IntN(256))
		}
		recipient, project, splices := spliceProject(input)
		again, projectAgain, splicesAgain := spliceProject(input)
		if recipient.name != again.name || !maps.Equal(project.Files, projectAgain.Files) || len(splices) != len(splicesAgain) {
			t.Fatalf("input %x spliced %s two ways", input, recipient.name)
		}
		if len(splices) == 0 {
			without++
			continue
		}
		for _, s := range splices {
			spliced[s.node.category]++
			if !spliceValid(s.node.category, s.node.kind, s.old) || !spliceValid(s.node.category, s.donorKind, s.new) {
				t.Errorf("%s: a node or its donor is not a valid %s", s, s.node.category)
			}
			if s.recipientText[s.node.start:s.node.end] != s.old {
				t.Errorf("%s: the replaced text is not the node's", s)
			}
		}
		if _, syntaxError := spliceNodes(project.Files[splices[len(splices)-1].file]); !syntaxError {
			parsing++
		}
	}
	t.Logf("%d of %d inputs spliced nothing; %d spliced files parse; splices by category: %v", without, inputs, parsing, spliced)
	if without > inputs/10 {
		t.Errorf("%d of %d inputs spliced nothing", without, inputs)
	}
	for c := range spliceCategories {
		if spliced[c] == 0 {
			t.Errorf("no input spliced a %s", c)
		}
	}
}

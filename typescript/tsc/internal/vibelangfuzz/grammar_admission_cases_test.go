package vibelangfuzz

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

// grammarAdmissionCase is a compiler case program Appendix A derives.
type grammarAdmissionCase struct{ name, source string }

// grammarAdmissionCaseLimit bounds the programs the survey reads, in bytes.
const grammarAdmissionCaseLimit = 6000

var (
	grammarAdmissionCasesOnce sync.Once
	grammarAdmissionCasesList []grammarAdmissionCase
	grammarAdmissionCasesRead struct {
		files, derived, syntax, noDerivation, skipped int
		stops                                         []string
		err                                           error
	}
)

// grammarAdmissionCases reads every .vibe program under typescript/vibelang/cases
// once and keeps those the lab derives: valid programs whose every form Appendix
// A admits. A program the compiler accepts but the lab cannot derive is a known
// lab or admission gap; it seeds nothing, and TestGrammarAdmissionCases reports
// it with the token where its last derivation stopped.
func grammarAdmissionCases(t testing.TB) []grammarAdmissionCase {
	grammarAdmissionCasesOnce.Do(func() {
		root := filepath.Join("..", "..", "..", "vibelang", "cases")
		var files []string
		r := &grammarAdmissionCasesRead
		r.err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() && d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			if !d.IsDir() && strings.HasSuffix(path, ".vibe") {
				files = append(files, path)
			}
			return nil
		})
		if r.err != nil {
			return
		}
		sort.Strings(files)
		for _, f := range files {
			data, err := os.ReadFile(f)
			if err != nil {
				r.err = err
				return
			}
			if len(data) > grammarAdmissionCaseLimit {
				r.skipped++
				continue
			}
			r.files++
			name, _ := filepath.Rel(root, f)
			name = filepath.ToSlash(name)
			source := string(data)
			mismatch, detail := grammarAdmissionMismatch(source)
			switch {
			case mismatch:
				r.noDerivation++
				r.stops = append(r.stops, name+"\t"+grammarAdmissionStop(source))
			case detail == "compiler syntax error":
				r.syntax++
			default:
				r.derived++
				grammarAdmissionCasesList = append(grammarAdmissionCasesList, grammarAdmissionCase{name, source})
			}
		}
	})
	if err := grammarAdmissionCasesRead.err; err != nil {
		t.Fatal(err)
	}
	if len(grammarAdmissionCasesList) == 0 {
		t.Fatal("no compiler case program derives from Appendix A")
	}
	return grammarAdmissionCasesList
}

// grammarAdmissionStop says where the lab's reading of a program stopped: the
// furthest Earley set with an item, as `<index>/<tokens> <context>`, with the
// stopping token in «», ⏎ before a token that starts a line, and `filtered`
// when derivations existed before the prose filters rejected them.
func grammarAdmissionStop(source string) string {
	lab, err := admissionLab()
	if err != nil {
		return err.Error()
	}
	toks := grammarLexSource(source)
	far, filtered := grammarAdmissionFurthest(lab.read(lab.g, toks, grammarParseMode{prose: true, names: true}))
	if rel, err := admissionRelationalLab(); err == nil {
		if f2, fl2 := grammarAdmissionFurthest(rel.read(rel.g, toks, grammarParseMode{prose: true, names: true})); f2 > far {
			far, filtered = f2, fl2
		}
	}
	var ctx []string
	for i := max(0, far-4); i < min(len(toks), far+2); i++ {
		s := toks[i].text
		if toks[i].nl {
			s = "⏎" + s
		}
		if i == far {
			s = "«" + s + "»"
		}
		ctx = append(ctx, s)
	}
	at := "<end>"
	if far < len(toks) {
		at = toks[far].text
	}
	out := fmt.Sprintf("%d/%d\tat=%s\t%s", far, len(toks), at, strings.Join(ctx, " "))
	if filtered {
		out += "\tfiltered"
	}
	return out
}

func grammarAdmissionFurthest(r grammarReading) (int, bool) {
	far := 0
	for i, set := range r.p.sets {
		if len(set) > 0 {
			far = i
		}
	}
	return far, r.p.count() > 0
}

// TestGrammarAdmissionCases requires all grammar gaps to be accounted for.
// VIBELANG_ADMISSION_CASES_REPORT prints their stopping tokens for comparison.
func TestGrammarAdmissionCases(t *testing.T) {
	cases := grammarAdmissionCases(t)
	r := grammarAdmissionCasesRead
	t.Logf("compiler cases: %d read, %d derive, %d are compiler syntax rejections, %d have no derivation, %d skipped over %d bytes", r.files, len(cases), r.syntax, r.noDerivation, r.skipped, grammarAdmissionCaseLimit)
	if os.Getenv("VIBELANG_ADMISSION_CASES_REPORT") != "" {
		for _, line := range r.stops {
			fmt.Println("NODERIV\t" + line)
		}
	}

	baseline, err := os.ReadFile(filepath.Join(repoTestdata(), "grammar_admission_no_derivation.txt"))
	if err != nil {
		t.Fatal(err)
	}
	known := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(string(baseline)), "\n") {
		if line != "" && !strings.HasPrefix(line, "#") {
			known[line] = true
		}
	}
	for _, stop := range r.stops {
		name, _, _ := strings.Cut(stop, "\t")
		if !known[name] {
			t.Errorf("case accepted without an Appendix A derivation: %s", stop)
		}
		delete(known, name)
	}
	for name := range known {
		t.Errorf("case no longer has an admission gap: remove %s from the baseline", name)
	}
}

// grammarAdmissionCasesInput maps fuzz data to a program. A seed is
// `case:<name>` and the program; a mutated seed keeps its name and drives
// token mutations of that case with its bytes; a seed whose case is gone
// replays the written program; raw data picks a case by its first two bytes.
func grammarAdmissionCasesInput(cases []grammarAdmissionCase, data []byte) (string, string) {
	if strings.HasPrefix(string(data), "case:") {
		if head, source, ok := strings.Cut(string(data), "\n"); ok {
			name := strings.TrimPrefix(head, "case:")
			i := sort.Search(len(cases), func(i int) bool { return cases[i].name >= name })
			if i < len(cases) && cases[i].name == name {
				if cases[i].source == source {
					return "case:" + name, source
				}
				return grammarAdmissionMutate(cases[i].source, []byte(source))
			}
			return grammarAdmissionMutationKey(source), source
		}
	}
	c := cases[(int(data[0])|int(data[1])<<8)%len(cases)]
	return grammarAdmissionMutate(c.source, data[1:])
}

func FuzzGrammarAdmissionCases(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#cf6d8b7ccc47907d
	// Chapter 001: inline module seeds violate the current grammar (FuzzGrammarAdmission).

	startShortBudget(f)
	w := NewWorkspace(f)
	cases := grammarAdmissionCases(f)
	for _, c := range cases {
		f.Add([]byte("case:" + c.name + "\n" + c.source))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) < 3 {
			t.Skip("bounded grammar subset")
		}
		key, source := grammarAdmissionCasesInput(cases, data)
		if len(source) > 2*grammarAdmissionCaseLimit {
			t.Skip("bounded grammar subset")
		}
		checkGrammarAdmission(t, w, key, source)
	})
}

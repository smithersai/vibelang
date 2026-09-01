package compiler

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

// Rows THREE and FIVE of specification/compatibility.mdx §Determinism-Sensitive
// Members, on the Go fork, against the same vectors the reference frontend is
// checked against by poc/src/language/ambient-charge.test.ts.
//
// THE DEFECT THIS FILE EXISTS FOR, and a documentation defect protected it.
// Both rows CHARGE a capability — `Promise.race`/`any` charge `Scheduler`, the
// ICU-backed members charge `Locale` — rather than refuse a name, because
// neither capability has a source-language surface an author could be pointed at
// instead. The reference implemented both. This backend implemented neither, and
// the true reason, recorded on `rowSet` in compiler/forkbridge/lowering.go.txt,
// was that its row table was `map[*ast.Symbol]errorRow` whose `addRow` returned
// false — silently — for a row with no symbol, which is exactly what an ambient
// capability has. Migration step 14 measured that and removed its own wiring
// rather than ship something that read as mirrored.
//
// Alongside that true reason stood a false one, in the same comment, in
// compatibility.mdx, and in the notes of the one corpus case that touches the
// class: that the disagreement was INVISIBLE to a differential, because "the
// harness compares stdout, diagnostics and exit code and cannot see a row at
// all". The premise is true and the conclusion does not follow. A row is not
// observable; an UNSATISFIED row is, on both backends, as `SMITHERS2102` at a
// top-level call, with the capability named in the message. The two backends
// could have been compared on rows three and five at any point, by any program
// whose charge reaches module scope — which is every vector below.
//
// That is why this file asserts a DIAGNOSTIC LIST rather than a row. It is the
// half of the charge both backends can be held to, and holding them to it is the
// thing the previous arrangement said could not be done.
//
// THE NEGATIVE CONTROLS ARE LOAD-BEARING and are not asserted absences. Four of
// the nine vectors charge nothing, and each is a positive vector with one token
// changed: `Promise.all` beside `Promise.race`, a lexically shadowed `Promise`
// beside the ambient one. A backend that charges nothing passes those four and
// fails the five positives; one that charges the `Promise` or `Intl` ROOT passes
// the positives and fails these. The two `SMITHERS1602` vectors are stronger
// still — they assert a refusal AND the absence of a charge beside it, so an
// over-charge appears as an extra diagnostic rather than as a silence.

// ambientChargeVector is one row of compiler/ambient-charge-vectors.json.
type ambientChargeVector struct {
	Name         string   `json:"name"`
	Why          string   `json:"why"`
	Source       string   `json:"source"`
	Requirements []string `json:"requirements"`
	Diagnostics  []string `json:"diagnostics"`
}

func loadAmbientChargeVectors(t *testing.T) []ambientChargeVector {
	t.Helper()
	text, err := os.ReadFile("ambient-charge-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Vectors []ambientChargeVector `json:"vectors"`
	}
	if err := json.Unmarshal(text, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Vectors) == 0 {
		t.Fatal("the shared ambient-charge corpus is empty")
	}
	return corpus.Vectors
}

// The fork answers every vector exactly as the reference does.
//
// Not a re-derivation of the rule in Go test code — that would be a third copy
// of a table that already exists twice. It is this backend's own output compared
// against a corpus whose expectations were derived by running the reference.
func TestPinnedForkAmbientRequirementChargesMatchTheSharedVectors(t *testing.T) {
	vectors := loadAmbientChargeVectors(t)

	charging := 0
	for _, vector := range vectors {
		if len(vector.Requirements) != 0 {
			charging++
		}
		t.Run(vector.Name, func(t *testing.T) {
			files := []SourceFile{{Path: "case.sm", Kind: FileKindSmithers, Text: vector.Source}}
			result := compileInternalSource(t, files)
			got := formatDiagnosticPositions(t, files, result)
			want := append([]string(nil), vector.Diagnostics...)
			// Diagnostic codes and decimal positions; provably ASCII, so byte
			// order and UTF-16 order are the same order here.
			sort.Strings(want)
			if strings.Join(got, " ") != strings.Join(want, " ") {
				t.Fatalf("%s\n  fork      = %v\n  reference = %v\n  messages  = %v",
					vector.Why, got, want, ambientChargeMessages(result))
			}
			// The PUBLISHED ROW, read back out of the message, not merely a
			// substring test for the capability's name. SMITHERS2102's message
			// is built from formatRowSet, so the braces carry the whole row and
			// this is the closest this backend's protocol gets to the direct row
			// assertion poc/src/language/ambient-charge.test.ts makes.
			//
			// Exactness is the point twice over. A SMITHERS2102 that named the
			// wrong capability, or that arrived because some unrelated rule
			// charged something, satisfies the position assertion above and
			// means nothing. And a row that named the RIGHT capability twice —
			// `{Locale, Locale}`, which is what a nominal read and an ambient
			// charge of one name produce unless the row collapses by name —
			// satisfies a substring test and diverges from the reference in text
			// no conformance case compares.
			if got, ok := ambientChargePublishedRow(result); ok {
				want := append([]string(nil), vector.Requirements...)
				sort.Strings(want)
				if strings.Join(got, "|") != strings.Join(want, "|") {
					t.Fatalf("the published requirement row disagrees\n  fork      = %v\n  reference = %v\n  messages  = %v",
						got, want, ambientChargeMessages(result))
				}
			} else if len(vector.Requirements) != 0 {
				t.Fatalf("this vector charges %v, yet no diagnostic publishes a requirement row: %v",
					vector.Requirements, ambientChargeMessages(result))
			}
			if len(vector.Requirements) == 0 {
				for _, name := range []string{"Scheduler", "Locale"} {
					if ambientChargeNames(result, name) {
						t.Fatalf("this vector charges nothing, yet a diagnostic names %q: %v",
							name, ambientChargeMessages(result))
					}
				}
			}
		})
	}

	// The corpus itself has to keep its teeth. An edit that turned every charging
	// vector into a control would leave a green file asserting nothing, which is
	// the failure mode this file was written to replace. Mirrored on the
	// reference side by the same count.
	if charging < 5 {
		t.Fatalf("only %d of %d vectors charge a capability; the corpus has lost the direction it exists to pin",
			charging, len(vectors))
	}
}

func ambientChargeMessages(result CompileResult) []string {
	messages := make([]string, 0, len(result.Diagnostics))
	for _, item := range result.Diagnostics {
		messages = append(messages, item.Code+": "+item.Message)
	}
	return messages
}

// ambientChargePublishedRow reads the requirement row back out of SMITHERS2102,
// whose message formatRowSet renders as `{A, B}`. The bridge's CompileResult
// protocol carries no rows, so this is how the row is observed from outside —
// and the fact that it CAN be observed from outside is the finding this file
// rests on.
func ambientChargePublishedRow(result CompileResult) ([]string, bool) {
	for _, item := range result.Diagnostics {
		if item.Code != "SMITHERS2102" {
			continue
		}
		open := strings.Index(item.Message, "{")
		closed := strings.LastIndex(item.Message, "}")
		if open < 0 || closed < open {
			return nil, false
		}
		body := item.Message[open+1 : closed]
		if strings.TrimSpace(body) == "" {
			return []string{}, true
		}
		names := strings.Split(body, ", ")
		sort.Strings(names)
		return names, true
	}
	return nil, false
}

func ambientChargeNames(result CompileResult, requirement string) bool {
	for _, item := range result.Diagnostics {
		if strings.Contains(item.Message, requirement) {
			return true
		}
	}
	return false
}

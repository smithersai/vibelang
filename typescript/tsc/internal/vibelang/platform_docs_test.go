package vibelang

import (
	"cmp"
	"os"
	"strings"
	"testing"
)

// skipVIPForm skips a comparison of a docs page with EK4402's tables while
// the page is written in the VIP language and the tables still give the old
// spelling: `try (try Path).resolve()` against `Path.resolve()`. The page's
// blocks wait for the compiler (a "// pending: VIP-" line); the comparison
// resumes when EK4402 writes the VIP forms (VIP-33).
func skipVIPForm(t *testing.T, page []byte) {
	t.Helper()
	if strings.Contains(string(page), "// pending: VIP-") {
		t.Skip("the page is in the VIP language; EK4402's tables give the old spelling until the compiler implements VIP-33")
	}
}

// The introduction includes complete calls and prose as well as API lookup
// names. Keep its examples and providers checked without treating the display
// spelling as a key in the diagnostic tables.
func TestPlatformDocsTable(t *testing.T) {
	page, err := os.ReadFile("../../../../docs/user/src/platform/105-introduction.md")
	if err != nil {
		t.Fatal(err)
	}
	skipVIPForm(t, page)
	for _, problem := range platformIntroductionProblems(string(page)) {
		t.Error(problem)
	}
}

// platformGlobalAnswer returns what the guide's page on platform globals says
// replaces name, a platform global or a member of one, read from the tables
// EK4402 reads: the Effect, experimental, or browser API's example, or the
// escape to TypeScript with its reason; "" when the tables give no answer.
func platformGlobalAnswer(name string) string {
	root, member, _ := strings.Cut(name, ".")
	var members []string
	if member != "" {
		members = strings.Split(member, ".")
	}
	api := platformAPIOf(platformRef{replacement: platformGlobals[root], name: root}, members)
	if s := platformServices[api.service]; s != nil {
		if example := cmp.Or(api.example, s.example); example != "" {
			return "`" + example + "`"
		}
		return s.use
	}
	if api.note != "" {
		return "escape to TypeScript for now: " + api.note
	}
	return ""
}

// TestPlatformGlobalsDocumented keeps every diagnostic's global/member in the
// guide, with complete Effect execution and explicit native-behavior caveats.
// The docs tools separately compile the displayed examples on the page.
func TestPlatformGlobalsDocumented(t *testing.T) {
	page := platformGlobalsPage(t)
	skipVIPForm(t, []byte(page))
	for _, problem := range platformGlobalsProblems(page) {
		t.Error(problem)
	}
}

// TestPlatformGlobalAnswerRequired checks that a platform global the tables
// do not answer, such as a name added to platformGlobals with no service and
// no note, has no answer for the page, so TestPlatformGlobalsDocumented fails
// until one is written.
func TestPlatformGlobalAnswerRequired(t *testing.T) {
	if answer := platformGlobalAnswer("unansweredGlobal"); answer != "" {
		t.Errorf("a global the tables do not answer gets %q", answer)
	}
	if answer := platformGlobalAnswer("unansweredGlobal.member"); answer != "" {
		t.Errorf("a member of a global the tables do not answer gets %q", answer)
	}
	for _, name := range []string{"document", "process.exit", "Worker"} {
		if platformGlobalAnswer(name) == "" {
			t.Errorf("%s has no answer", name)
		}
	}
}

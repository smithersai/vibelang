package vibelang

import (
	"cmp"
	"strings"
	"testing"
)

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

// TestPlatformGlobalAnswerRequired checks that a platform global the tables
// do not answer, such as a name added to platformGlobals with no service and
// no note, has no answer for the page, so TestPlatformGlobalsTableMutations fails
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

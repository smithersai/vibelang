package vibelang

import (
	"cmp"
	"os"
	"regexp"
	"slices"
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

// The platform introduction's table says what EK4402 and EK4403 say: each
// call's Effect replacement, which needs no import (D310, D311), and the
// layer that provides it.
func TestPlatformDocsTable(t *testing.T) {
	page, err := os.ReadFile("../../../../docs/user/src/platform/105-introduction.md")
	if err != nil {
		t.Fatal(err)
	}
	skipVIPForm(t, page)
	reads := map[string]string{"performance.now": "Performance.now", "crypto.randomUUID": "Crypto.randomUUID"}
	code := regexp.MustCompile("^`([^`]*)`$")
	rows := 0
	for _, line := range strings.Split(string(page), "\n") {
		cells := strings.Split(strings.Trim(line, "| "), " | ")
		if len(cells) != 3 || !code.MatchString(cells[0]) {
			continue
		}
		rows++
		call := code.FindStringSubmatch(cells[0])[1]
		effect, layer := strings.Trim(cells[1], "`"), strings.Trim(cells[2], "`")
		// VIP-33 allows ECMA-262 reads; these rows are optional advice.
		if call == "Date.now" || call == "Math.random" {
			continue
		}
		var s *platformService
		if key, ok := reads[call]; ok {
			read := clockReads[key]
			s = platformServices[read.service]
			if !strings.HasPrefix(read.use, effect) {
				t.Errorf("%s: the page says %s, EK4403 says %s", call, effect, read.use)
			}
		} else {
			root, member, _ := strings.Cut(call, ".")
			ref := platformRef{name: root}
			if service, ok := platformGlobals[root]; ok {
				ref.replacement = service
			} else if service, ok := platformModuleOf(root); ok {
				ref.replacement, ref.module = service, root
			} else {
				t.Errorf("%s is no platform API", call)
				continue
			}
			var members []string
			if member != "" {
				members = strings.Split(member, ".")
			}
			api := platformAPIOf(ref, members)
			s = platformServices[api.service]
			if s == nil {
				t.Errorf("%s: EK4402 names no service", call)
				continue
			}
			if example := cmp.Or(api.example, s.example); example != effect {
				t.Errorf("%s: the page says %s, EK4402 says %s", call, effect, example)
			}
		}
		if s == nil || s.provider == "" {
			if layer != "none" {
				t.Errorf("%s: the page says %s for a service no layer provides", call, layer)
			}
			continue
		}
		if !strings.Contains(s.provider, layer) {
			t.Errorf("%s: the page provides %s, EK4402 says %s", call, layer, s.provider)
		}
	}
	if rows < 10 {
		t.Fatalf("found %d rows in the table of replacements", rows)
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

// TestPlatformGlobalsDocumented checks the guide's page on platform globals
// against the tables EK4402 reads (D310): every platform global has an answer,
// an Effect API, an experimental service, or the escape to TypeScript with its
// reason, and the page has a row for every platform global and every member
// the tables answer, each saying what EK4402 says. The docs tools' test
// platform-globals.test.ts checks that each row's example compiles on the page.
func TestPlatformGlobalsDocumented(t *testing.T) {
	var names []string
	for name := range platformGlobals {
		names = append(names, name)
	}
	for api := range platformAPIs {
		root, _, _ := strings.Cut(api, ".")
		if _, ok := platformGlobals[root]; ok && api != root && !strings.Contains(api, "*") {
			names = append(names, api)
		}
	}
	slices.Sort(names)
	var want []string
	for _, name := range names {
		answer := platformGlobalAnswer(name)
		if answer == "" {
			t.Errorf("%s is not in a .vibe file's scope, and the tables give no answer: name an Effect API, an experimental service, or the reason to escape to TypeScript", name)
		}
		want = append(want, "| `"+name+"` | "+answer+" |")
	}
	page, err := os.ReadFile("../../../../docs/user/src/platform/platform-globals.md")
	if err != nil {
		t.Fatal(err)
	}
	skipVIPForm(t, page)
	var got []string
	for _, line := range strings.Split(string(page), "\n") {
		if strings.HasPrefix(line, "| `") {
			got = append(got, line)
		}
	}
	if !slices.Equal(got, want) {
		t.Errorf("the page's table is\n%s\nEK4402's tables give\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
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

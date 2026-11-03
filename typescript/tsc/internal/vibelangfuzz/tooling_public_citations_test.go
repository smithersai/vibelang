package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Public authority is already the rule in the Introduction. Check both the
// local citation and its accepted public amendment; a file existing is not
// evidence that it states the cited rule.
const toolingAuthorityQuote = "This specification defines VibeLang as the accepted VibeLang Improvement Proposals (VIPs) and their public amendments define it, and nothing more."

var toolingPrivateCitation = regexp.MustCompile(`(?i)\b(?:decided[\s\p{Zs}]+)?details?[\s\p{Zs}]+[0-9]`)

type toolingPublicSource struct {
	File    string `json:"file"`
	Heading string `json:"heading"`
}
type toolingPublicRule struct {
	Key     string                `json:"key"`
	Claim   string                `json:"claim"`
	Sources []toolingPublicSource `json:"sources"`
}

func toolingPublicRules(t testing.TB) []toolingPublicRule {
	t.Helper()
	data, err := os.ReadFile("testdata/tooling-public-citations.json")
	if err != nil {
		t.Fatal(err)
	}
	var rules []toolingPublicRule
	if err := json.Unmarshal(data, &rules); err != nil {
		t.Fatal(err)
	}
	if len(rules) == 0 {
		t.Fatal("empty tooling public-source oracle")
	}
	return rules
}

func toolingPublicText(t testing.TB) string {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	return withoutFoldedDetails(string(text))
}

func checkToolingPublicRule(t testing.TB, text string, rule toolingPublicRule) {
	t.Helper()
	var line string
	for _, candidate := range strings.Split(text, "\n") {
		if strings.Contains(candidate, rule.Claim) {
			line = candidate
			break
		}
	}
	if line == "" {
		Gap(t, "FuzzToolingPublicCitations", "quote:"+rule.Key, "chapter 007 no longer says %q", rule.Claim)
	}
	for _, source := range rule.Sources {
		link := "../vips/" + source.File + "#decision"
		if !strings.Contains(line, link) {
			Gap(t, "FuzzToolingPublicCitations", "source:"+rule.Key, "claim %q lacks its public citation %s", rule.Claim, link)
		}
		data, err := os.ReadFile(filepath.Join(Root(), "docs/design/vips", source.File))
		if err != nil {
			t.Fatal(err)
		}
		public := string(data)
		if !strings.Contains(public, "**Status:** accepted") || !strings.Contains(public, source.Heading) {
			Gap(t, "FuzzToolingPublicCitations", "amendment:"+rule.Key, "%s is not an accepted source stating %q", source.File, source.Heading)
		}
	}
}

func TestToolingPublicCitationsQuoted(t *testing.T) {
	intro, err := os.ReadFile(SpecPath("000-intro.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(intro), toolingAuthorityQuote) {
		t.Fatalf("public authority rule changed: %q", toolingAuthorityQuote)
	}
	text := toolingPublicText(t)
	if match := toolingPrivateCitation.FindString(text); match != "" {
		t.Errorf("chapter 007 still cites a private numbered rule: %q", match)
	}
	for _, rule := range toolingPublicRules(t) {
		t.Run(rule.Key, func(t *testing.T) { checkToolingPublicRule(t, text, rule) })
	}
}

// Fuzz the complete citation family rather than one private number: singular,
// plural, short-form, mixed case and ASCII/Unicode spaces. Named role keys keep
// the saved corpus attached to the same actual chapter/amendment pair.
func FuzzToolingPublicCitations(f *testing.F) {
	startShortBudget(f)
	rules := toolingPublicRules(f)
	for _, rule := range rules {
		f.Add(rule.Key, uint32(42), uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, number uint32, style uint8) {
		rule := rules[int(number%uint32(len(rules)))]
		for _, candidate := range rules {
			if candidate.Key == key {
				rule = candidate
				break
			}
		}
		text := toolingPublicText(t)
		if match := toolingPrivateCitation.FindString(text); match != "" {
			Gap(t, "FuzzToolingPublicCitations", "private-source:"+rule.Key, "private citation remains: %q", match)
		}
		checkToolingPublicRule(t, text, rule)
		spaces := []string{" ", "\t", "\n", "\u00a0"}
		space := spaces[int(style>>3)%len(spaces)]
		forms := []string{"decided detail", "decided details", "detail", "details", "Decided Detail", "DECIDED DETAILS"}
		private := strings.ReplaceAll(forms[int(style)%len(forms)], " ", space) + space + fmt.Sprint(number)
		if !toolingPrivateCitation.MatchString(private) {
			Gap(t, "FuzzToolingPublicCitations", "private:"+rule.Key, "missed private citation %q", private)
		}
		public := "[VIP-" + fmt.Sprint(number) + "](../vips/public.md#decision)"
		if toolingPrivateCitation.MatchString(public) {
			Gap(t, "FuzzToolingPublicCitations", "public:"+rule.Key, "rejected public citation %q", public)
		}
	})
}

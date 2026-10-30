package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestRegistryUsesCurrentAppendix(t *testing.T) {
	facts := Facts()
	for _, tc := range []struct {
		code       int32
		want       DefaultCategory
		adjustable bool
	}{
		{801, DefaultWarning, true}, {508, DefaultWarning, true},
		{4701, DefaultError, false}, {901, DefaultError, false},
	} {
		if !facts.IsRegistered(tc.code) || facts.Default(tc.code) != tc.want || facts.IsAdjustable(tc.code) != tc.adjustable {
			t.Errorf("%s: registered=%v default=%s adjustable=%v", specCodeName(tc.code), facts.IsRegistered(tc.code), facts.Default(tc.code), facts.IsAdjustable(tc.code))
		}
	}
	// Interim codes are registered with their row's category, but they are
	// neither language rules nor configurable.
	for _, tc := range []struct {
		code int32
		want DefaultCategory
	}{{9201, DefaultError}, {9204, DefaultWarning}} {
		if !SpecHasCode(tc.code) || facts.Default(tc.code) != tc.want || slices.Contains(SpecCodes(), tc.code) || facts.IsAdjustable(tc.code) {
			t.Errorf("%s: interim identity wrong: default=%s adjustable=%v", specCodeName(tc.code), facts.Default(tc.code), facts.IsAdjustable(tc.code))
		}
	}
	// Appendix B now holds the migration warnings; they left the VIP-ahead list.
	if !slices.Contains(SpecCodes(), 4853) || facts.Default(4853) != DefaultWarning || !facts.IsAdjustable(4853) || slices.Contains(vipCodes, 4853) {
		t.Errorf("EK4853: default=%s adjustable=%v", facts.Default(4853), facts.IsAdjustable(4853))
	}
	if SpecHasCode(4409) || SpecHasCode(3008) {
		t.Error("history-only EK4409/EK3008 leaked into the current registry")
	}
	// The imported table states each default, and every imported code is
	// configurable; ordinals past 99 extend the code.
	for _, tc := range []struct {
		code int32
		want DefaultCategory
	}{{3801, DefaultError}, {3802, DefaultSuggestion}, {3805, DefaultOff}, {3836, DefaultWarning}, {38100, DefaultSuggestion}, {38130, DefaultWarning}} {
		if !SpecHasCode(tc.code) || facts.Default(tc.code) != tc.want || !facts.IsAdjustable(tc.code) {
			t.Errorf("%s: imported default=%s adjustable=%v", specCodeName(tc.code), facts.Default(tc.code), facts.IsAdjustable(tc.code))
		}
	}
	for _, code := range []int32{38131, 3901} {
		if SpecHasCode(code) || facts.IsAdjustable(code) {
			t.Errorf("%s has no imported row", specCodeName(code))
		}
	}
	for _, code := range []int32{2001, 2002, 2003, 2004, 2005, 2102, 2103, 2104, 3006, 3007, 3201} {
		if slices.Contains(facts.Retired, code) {
			t.Errorf("%s is reused by Appendix B, not retired", specCodeName(code))
		}
	}
	if !slices.Equal(facts.Reused, []int32{2001, 2002, 2003, 2004, 2005, 2102, 2103, 2104, 3006, 3007, 3201}) {
		t.Errorf("reused codes: %v", facts.Reused)
	}
	if !slices.Equal(facts.Retired, []int32{2101}) || SpecHasCode(2101) {
		t.Errorf("old EK2101 retirement: %v", facts.Retired)
	}
	if p := deadKey(PendingEntry{Key: "ek:EK4409"}); p == "" {
		t.Error("a pending history-only code must be dead")
	}
	if p := deadKey(PendingEntry{Key: "ek:EK0901"}); p != "" {
		t.Errorf("current code rejected: %s", p)
	}
	if deadKey(PendingEntry{Key: "registry:EK4701"}) == "" {
		t.Error("registered-code registry pending key must be dead")
	}
	if problem := deadKey(PendingEntry{Key: "registry:EK4409"}); problem != "" {
		t.Errorf("unassigned registry key must remain live: %s", problem)
	}

}

// TestCurrentConfigFacts proves that an own error code cannot appear in
// severities even when its requested category is error (007-tooling.md).
func TestCurrentConfigFacts(t *testing.T) {
	if Facts().SeverityConfigCode != 3006 || Facts().ConfigValueCode != 3007 {
		t.Fatalf("current config rule numbers: %d / %d", Facts().SeverityConfigCode, Facts().ConfigValueCode)
	}
	for _, severity := range Facts().Severities {
		if problems := settingProblems(map[string]any{"severities": map[string]any{"EK4701": severity}}); len(problems) != 1 {
			t.Errorf("EK4701=%s: expected EK3006 rule, got %v", severity, problems)
		}
		if problems := settingProblems(map[string]any{"severities": map[string]any{"EK0801": severity, "EK3801": severity}}); len(problems) != 0 {
			t.Errorf("valid warning/imported severity=%s: %v", severity, problems)
		}
	}
	if problems := settingProblems(map[string]any{"severities": map[string]any{"EK38131": "off"}}); len(problems) != 1 {
		t.Errorf("an unassigned imported ordinal is not a valid configuration entry: %v", problems)
	}
	if !strings.Contains(Facts().Rows[3006].Reports, "vibe.severities") {
		t.Error("Appendix B no longer assigns EK3006 to invalid severity entries")
	}
}

func TestCurrentRegistryTables(t *testing.T) {
	rows := diagnosticTable("| Code | Rule | VIP | Chapter |\n| --- | --- | --- | --- |\n| `EK0301` | a | b | 3 | [Functions](001-functions.md) |\n", []string{"Code", "Rule", "VIP", "Chapter"}, true)
	if len(rows) != 1 || rows[0][1] != "a | b" || rows[0][2] != "3" {
		t.Fatalf("pipe moved the rule columns: %v", rows)
	}
	for _, text := range []string{"", "| Code | Rule | VIP | Chapter |\n| --- | --- | --- | --- |"} {
		func() {
			defer func() {
				if recover() == nil {
					t.Error("missing table/rows did not panic")
				}
			}()
			diagnosticTable(text, []string{"Code", "Rule", "VIP", "Chapter"}, true)
		}()
	}
}

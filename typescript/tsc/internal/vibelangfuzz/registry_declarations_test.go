package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// legacyDeclared tracks unassigned implementation declarations, not accepted
// diagnostics. Each entry expires when its declaration disappears or its
// number gains a current assignment; TestCompilerRegistryIsSpecified checks it.
var legacyDeclared = map[int32]string{
	1001: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1002: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1003: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1005: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1006: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1007: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1011: "lane del-rest; declaration only: missing Effect-type diagnostic has no reached emission witness",                                                               // diagnostics.go
	1012: "lane del-rest",                                                                                                                                                 // diagnostics.go
	1013: "lane del-rest",                                                                                                                                                 // fieldcommas.go
	1015: "lane del-rest",                                                                                                                                                 // syntax.go
	1017: "lane del-rest",                                                                                                                                                 // syntax.go
	1023: "lane del-rest; declaration only: under VIP-1 a block is a program, so the appended call D382 reported no longer type-checks and no reduced witness reaches it", // diagnostics.go
	2006: "lane del-2",                                                                                                                                                    // diagnostics.go
	2105: "lane del-2",                                                                                                                                                    // diagnostics.go
	2106: "lane del-2",                                                                                                                                                    // diagnostics.go
	2107: "lane d-handlers",                                                                                                                                               // diagnostics.go
	2108: "lane d-handlers",                                                                                                                                               // diagnostics.go
	2110: "lane d-handlers",                                                                                                                                               // handle_results.go
	2112: "lane del-rest",                                                                                                                                                 // diagnostics.go
	2113: "lane del-2",                                                                                                                                                    // diagnostics.go
	2114: "lane del-rest",                                                                                                                                                 // catch_expressions.go
	2115: "lane gate6-codes; declaration only: native check removed; stock TypeScript mapper still emits EK2115",                                                          // diagnostics.go
	2118: "lane del-rest",                                                                                                                                                 // diagnostics.go
	2119: "lane d-handlers",                                                                                                                                               // handle_results.go
	2120: "lane del-2",                                                                                                                                                    // declaration_forms.go
	2121: "lane del-2",                                                                                                                                                    // declaration_forms.go
	2122: "lane del-rest",                                                                                                                                                 // data.go
	2124: "lane del-rest",                                                                                                                                                 // data.go
	2125: "lane del-rest",                                                                                                                                                 // data.go
	2127: "lane del-rest",                                                                                                                                                 // data.go
	3008: "lane fix-diag-renumber; declaration only: the service-declaration fix still reports 0.0.10's EK3008; Appendix B's rule is EK0901",                              // fix_service_declarations.go
	3101: "lane del-rest",                                                                                                                                                 // diagnostics.go
	3202: "lane vip-remove3",                                                                                                                                              // diagnostics.go
	3203: "lane vip-remove3",                                                                                                                                              // diagnostics.go
	3204: "lane vip-remove3",                                                                                                                                              // diagnostics.go
	3205: "lane vip-remove3",                                                                                                                                              // diagnostics.go
	3206: "lane vip-remove3",                                                                                                                                              // diagnostics.go
	3207: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4201: "lane d-handlers",                                                                                                                                               // diagnostics.go
	4202: "lane d-handlers",                                                                                                                                               // diagnostics.go
	4301: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4401: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4403: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4405: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4406: "lane del-rest",                                                                                                                                                 // diagnostics.go
	4001: "lane vip40-core",
	4002: "lane vip40-core",
	4003: "lane vip40-core",
	4004: "lane vip40-core",
	4006: "lane vip40-core",
	4008: "lane vip40-core",
	4408: "lane del-rest",                                                                                                             // diagnostics.go
	4409: "decide-live decides",                                                                                                       // diagnostics.go
	4410: "lane del-rest",                                                                                                             // keyword_bindings.go
	4501: "lane del-rest",                                                                                                             // diagnostics.go
	4502: "lane del-rest",                                                                                                             // call_pipe_diagnostic.go
	4503: "lane del-rest",                                                                                                             // service_value_diagnostic.go
	4601: "lane del-rest; declaration only: effect-body await uses EK0102, so no reduced source witness reaches this legacy fallback", // fibers.go
	4602: "lane del-rest",                                                                                                             // fibers.go
	4603: "lane del-rest",                                                                                                             // fibers.go
	4604: "lane del-rest",                                                                                                             // fibers.go
	4607: "lane del-rest",                                                                                                             // fibers.go
	4611: "lane del-rest",                                                                                                             // fibers.go
	4612: "lane del-rest",                                                                                                             // fibers.go
	4702: "lane del-rest",                                                                                                             // match.go
	4703: "lane del-rest",                                                                                                             // match.go
	4704: "lane del-rest",                                                                                                             // match.go
	4705: "lane del-rest",                                                                                                             // match.go
	4706: "lane del-rest",                                                                                                             // data.go
	4707: "lane del-rest",                                                                                                             // data.go
	4801: "lane del-rest",                                                                                                             // lsrules.go
	4803: "lane del-rest",                                                                                                             // lsrules.go
	4804: "lane del-rest",                                                                                                             // lsrules.go
	4805: "lane del-rest",                                                                                                             // lsrules.go
	4806: "lane del-rest",                                                                                                             // lsrules.go
	4807: "lane del-rest",                                                                                                             // lsrules.go
	4808: "lane del-rest",                                                                                                             // lsrules.go
	4809: "lane del-rest",                                                                                                             // lsrules.go
	4810: "lane del-rest",                                                                                                             // lsrules.go
	4811: "lane del-rest",                                                                                                             // messageOff in lsrules.go
	4812: "lane del-rest",                                                                                                             // lsrules.go
	4813: "lane del-rest",                                                                                                             // lsrules.go
	4814: "lane del-rest",                                                                                                             // lsrules.go
	4815: "lane del-rest",                                                                                                             // lsrules.go
	4816: "lane del-rest",                                                                                                             // messageOff in lsrules.go
	4817: "lane del-rest",                                                                                                             // messageOff in lsrules.go
	4818: "lane del-rest",                                                                                                             // messageOff in lsrules.go
	4819: "lane del-rest; declaration only: editor lint diagnostic has no reached emission witness",                                   // lsrules_ts.go
	4820: "lane del-rest; declaration only: editor lint diagnostic has no reached emission witness",                                   // lsrules_ts.go
	4821: "lane del-rest",                                                                                                             // messageOff in lsrules_style.go
	4822: "lane del-rest",                                                                                                             // messageOff in lsrules_style.go
	4823: "lane del-rest",                                                                                                             // messageOff in lsrules_style.go
	4824: "lane del-rest",                                                                                                             // messageOff in lsrules_style.go
	4825: "lane del-rest",                                                                                                             // messageOff in lsrules_style.go
	4838: "lane del-4",                                                                                                                // fork_escape.go
	4840: "lane del-rest",                                                                                                             // fix_option.go
	4843: "lane del-4",                                                                                                                // entry_const_main.go
	9100: "lane core-land; declaration only: annotation-migration report is an editor tool diagnostic",                                // lsrules_fixes.go
	9101: "lane core-land; declaration only: data-method annotation report is an editor tool diagnostic",                              // lsrules_fixes.go
}

// TestRegistryDebtLedger checks the two views of one debt ledger. An emitted
// legacy code has a named, reduced corpus witness. A declaration without an
// emission witness explains that asymmetry on its own side.
func TestRegistryDebtLedger(t *testing.T) {
	entries, err := pendingEntries()
	if err != nil {
		t.Fatal(err)
	}
	emitted := map[int32]bool{}
	for _, entry := range entries {
		match := registryKey.FindStringSubmatch(entry.Key)
		if match == nil {
			continue
		}
		number, _ := strconv.Atoi(match[1])
		code := int32(number)
		emitted[code] = true
		if _, ok := legacyDeclared[code]; !ok {
			t.Errorf("%s %s: missing legacyDeclared entry", entry.Target, entry.Key)
		}
		name := "registry-EK" + match[1]
		if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", entry.Target, name)); err != nil {
			t.Errorf("%s %s: missing reduced witness %s: %v", entry.Target, entry.Key, name, err)
		}
		if _, ok := Pending(entry.Target, "corpus:"+name); !ok {
			t.Errorf("%s %s: its witness has no XPASS corpus marker", entry.Target, entry.Key)
		}
	}
	for code, reason := range legacyDeclared {
		explained := strings.Contains(reason, "declaration only: ")
		if !emitted[code] && !explained {
			t.Errorf("%s: missing registry: pending key or declaration-only explanation", specCodeName(code))
		}
		if emitted[code] && explained {
			t.Errorf("%s: remove its stale declaration-only explanation", specCodeName(code))
		}
	}
}

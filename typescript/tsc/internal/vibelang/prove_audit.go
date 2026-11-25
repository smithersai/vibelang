package vibelang

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// The audit of vibelang prove (VIP-43, Appendix F "Steps", step 6). After
// LemmaScript generates P.dfy.gen from a module's lowering file, the audit
// checks three things that a passing Dafny run does not show:
//
//   - Obligations (4317): the Dafny member for each lowered function, with
//     its _ensures lemma, holds exactly as many assert statements and
//     ensures clauses as the lowering wrote //@ assert and //@ ensures
//     lines for the function. A lost one would let a false proof pass.
//   - Classification (4317): the member for a transparent function is a
//     Dafny function and the member for a procedure a method.
//   - Assumptions (4318): dafny audit reports nothing for the hand-written
//     P.dfy that it does not report for P.dfy.gen, by member and message.
//
// The checks are functions of the two Dafny texts and of dafny audit's two
// outputs; runProofAudit gathers those and reports what the checks find.

// ProofFunction is a function the lowering marked //@ verify: a checked
// function, a spec function or a theorem's generated function.
type ProofFunction struct {
	ProofDeclaration
	// Obligations is the number of //@ assert and //@ ensures lines the
	// lowering wrote for the function.
	Obligations int
	// Transparent is whether VibeLang classifies the function as
	// transparent, which LemmaScript emits as a Dafny function, and not as
	// a procedure, which it emits as a method. A theorem is transparent in
	// its lemma form.
	Transparent bool
}

// countObligations counts the //@ assert and //@ ensures lines of lowered,
// the printed lowering of one function.
func countObligations(lowered string) int {
	count := 0
	for _, line := range strings.Split(lowered, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "//@ assert ") || strings.HasPrefix(line, "//@ ensures ") {
			count++
		}
	}
	return count
}

// lemmaScriptInfo is what the audit reads of lsc info --typed's output.
type lemmaScriptInfo struct {
	Dafny struct {
		// EmittedNames maps a source name to the Dafny name LemmaScript
		// emits for it.
		EmittedNames map[string]string `json:"emittedNames"`
		Error        string            `json:"error"`
	} `json:"dafny"`
}

// parseLemmaScriptInfo reads the JSON object in output, lsc info --typed's
// standard output.
func parseLemmaScriptInfo(output string) (lemmaScriptInfo, bool) {
	var info lemmaScriptInfo
	start := strings.Index(output, "{")
	if start < 0 || json.Unmarshal([]byte(output[start:]), &info) != nil {
		return info, false
	}
	return info, true
}

// dafnyName is the Dafny member name for the source name name.
func (info lemmaScriptInfo) dafnyName(name string) string {
	if emitted := info.Dafny.EmittedNames[name]; emitted != "" {
		return emitted
	}
	return name
}

// dafnyMemberText is one member of a Dafny file.
type dafnyMemberText struct {
	// kind is function, predicate, method or lemma.
	kind string
	// obligations counts the member's assert statements and ensures clauses.
	obligations int
}

// dafnyMemberHead matches the first line of a Dafny member, and captures its
// kind and name.
var dafnyMemberHead = regexp.MustCompile(`^(?:(?:ghost|opaque|static)\s+)*(function|predicate|method|lemma)\s+(?:\{[^}]*\}\s*)*([A-Za-z_][A-Za-z0-9_']*)`)

// dafnyObligation matches a line that starts an assert statement or an
// ensures clause.
var dafnyObligation = regexp.MustCompile(`^\s+(?:assert|ensures)\b`)

// dafnyMembers returns the members of text, a Dafny file, by name. A member
// runs from its first line, at column 1, to the next member's.
func dafnyMembers(text string) map[string]*dafnyMemberText {
	members := map[string]*dafnyMemberText{}
	var current *dafnyMemberText
	for _, line := range strings.Split(text, "\n") {
		if m := dafnyMemberHead.FindStringSubmatch(line); m != nil {
			current = &dafnyMemberText{kind: m[1]}
			members[m[2]] = current
			continue
		}
		if current != nil && dafnyObligation.MatchString(line) {
			current.obligations++
		}
	}
	return members
}

// proofAuditFinding is one difference the audit found.
type proofAuditFinding struct {
	// function is the lowered function the finding is about, or nil for one
	// about the module.
	function *ProofFunction
	message  *Message
	args     []any
}

var (
	auditLostObligation = EK4317.With("LemmaScript's Dafny for {0} holds {1} assert statements and ensures clauses, and the lowering wrote {2}, so an assertion or postcondition is lost or added. This is a LemmaScript defect to report upstream; until it is fixed, state {0}'s facts in a form LemmaScript keeps.")
	auditMissingMember  = EK4317.With("LemmaScript's Dafny holds no member for {0}, so nothing proves it. This is a LemmaScript defect to report upstream; keep reached code inside LemmaScript's subset.")
	auditClassification = EK4317.With("LemmaScript emits {0} as a Dafny {1}, and VibeLang classifies it as a {2}, which is a Dafny {3}. This is a LemmaScript defect to report upstream; until it is fixed, write {0} so that both agree.")
	auditAssumption     = EK4318.With("{0} adds an assumption in {1} that dafny audit reports: {2}. Prove the assumed fact: a hand-written addition may prove, never assume.")
)

// auditGeneratedDafny checks the obligations and the classification of
// functions against generated, the text of P.dfy.gen.
func auditGeneratedDafny(functions []ProofFunction, info lemmaScriptInfo, generated string) []proofAuditFinding {
	var findings []proofAuditFinding
	members := dafnyMembers(generated)
	for i := range functions {
		fn := &functions[i]
		name := info.dafnyName(fn.Name)
		member := members[name]
		if member == nil {
			findings = append(findings, proofAuditFinding{fn, auditMissingMember, []any{fn.Name}})
			continue
		}
		held := member.obligations
		lemmaName := name + "_ensures"
		if emitted := info.Dafny.EmittedNames[fn.Name+"_ensures"]; emitted != "" {
			lemmaName = emitted
		}
		if lemma := members[lemmaName]; lemma != nil {
			held += lemma.obligations
		}
		if held != fn.Obligations {
			findings = append(findings, proofAuditFinding{fn, auditLostObligation, []any{fn.Name, held, fn.Obligations}})
		}
		isFunction := member.kind == "function" || member.kind == "predicate"
		switch {
		case fn.Transparent && !isFunction:
			findings = append(findings, proofAuditFinding{fn, auditClassification, []any{fn.Name, member.kind, "transparent function", "function"}})
		case !fn.Transparent && isFunction:
			findings = append(findings, proofAuditFinding{fn, auditClassification, []any{fn.Name, member.kind, "procedure", "method"}})
		}
	}
	return findings
}

// dafnyAssumption is one finding of dafny audit.
type dafnyAssumption struct {
	// member is the Dafny member that holds the finding, or "".
	member  string
	message string
}

// dafnyAuditLine matches a finding of dafny audit, which it prints as a
// warning: P.dfy(L,C): Warning: M.
var dafnyAuditLine = regexp.MustCompile(`^(.*\.dfy)\((\d+),(\d+)\): Warning: (.*)$`)

// dafnyAssumptions returns the findings in output, dafny audit's output for
// the Dafny file whose text is dfy, each with the member that holds it.
func dafnyAssumptions(output string, dfy string) []dafnyAssumption {
	lines := strings.Split(dfy, "\n")
	var found []dafnyAssumption
	for _, line := range strings.Split(output, "\n") {
		m := dafnyAuditLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		n, _ := strconv.Atoi(m[2])
		found = append(found, dafnyAssumption{member: dafnyMemberAt(lines, n), message: m[4]})
	}
	return found
}

// addedAssumptions returns the findings of written, the hand-written
// P.dfy's, that generated, P.dfy.gen's, do not hold, compared by member and
// message. A finding that both hold as many times is LemmaScript's own.
func addedAssumptions(written []dafnyAssumption, generated []dafnyAssumption) []dafnyAssumption {
	remaining := map[dafnyAssumption]int{}
	for _, a := range generated {
		remaining[a]++
	}
	var added []dafnyAssumption
	for _, a := range written {
		if remaining[a] > 0 {
			remaining[a]--
			continue
		}
		added = append(added, a)
	}
	return added
}

// auditAssumptions checks that P.dfy adds no assumption to P.dfy.gen.
func auditAssumptions(source string, functions []ProofFunction, info lemmaScriptInfo, written []dafnyAssumption, generated []dafnyAssumption) []proofAuditFinding {
	var findings []proofAuditFinding
	for _, added := range addedAssumptions(written, generated) {
		var at *ProofFunction
		for i := range functions {
			if name := info.dafnyName(functions[i].Name); added.member == name || strings.TrimSuffix(added.member, "_ensures") == name {
				at = &functions[i]
			}
		}
		where := "the member " + added.member
		if added.member == "" {
			where = "the file"
		}
		findings = append(findings, proofAuditFinding{at, auditAssumption, []any{source + ".dfy", where, added.message}})
	}
	return findings
}

// runLemmaScriptInfo runs lsc info --typed on module's lowering file, for
// the Dafny names of its functions. It returns a problem when LemmaScript
// rejects the file.
func runLemmaScriptInfo(ctx context.Context, lsc string, proofDirectory string, module ProofModule) (lemmaScriptInfo, string) {
	cmd := exec.CommandContext(ctx, "node", lsc, "info", "--typed", module.Source+".ts")
	cmd.Dir = proofDirectory
	cmd.Env = append(os.Environ(), "LSC_RUN_LOG=true")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return lemmaScriptInfo{}, firstLine(stderr.String() + "\n" + stdout.String())
	}
	info, ok := parseLemmaScriptInfo(stdout.String())
	switch {
	case !ok:
		return info, "lsc info --typed printed no JSON: " + firstLine(stdout.String())
	case info.Dafny.Error != "":
		return info, info.Dafny.Error
	}
	return info, ""
}

// auditCopySuffix names the copy of P.dfy.gen that dafny audit reads: Dafny
// reads no extension but .dfy. The audit removes the copy.
const auditCopySuffix = ".gen.audit.dfy"

// runDafnyAudit runs dafny audit on file, relative to proofDirectory, and
// returns its findings.
func runDafnyAudit(ctx context.Context, proofDirectory string, file string, text string) []dafnyAssumption {
	cmd := exec.CommandContext(ctx, "dafny", "audit", file)
	cmd.Dir = proofDirectory
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	_ = cmd.Run() // dafny audit exits with a non-zero status when it finds an assumption
	return dafnyAssumptions(output.String(), text)
}

// runProofAudit audits module after lsc regen, reports each difference at
// its declaration, and returns whether the audit found none.
func runProofAudit(ctx context.Context, proofDirectory string, module ProofModule, info lemmaScriptInfo, report func(*ast.Diagnostic)) bool {
	base := filepath.Join(proofDirectory, filepath.FromSlash(module.Source))
	generated, err := os.ReadFile(base + ".dfy.gen")
	if err != nil {
		report(proveDiagnostic(module.Roots[0].File, nil, EK4317, "LemmaScript wrote no "+module.Source+".dfy.gen"))
		return false
	}
	findings := auditGeneratedDafny(module.Functions, info, string(generated))
	if written, err := os.ReadFile(base + ".dfy"); err == nil {
		copied := base + auditCopySuffix
		if err := os.WriteFile(copied, generated, 0o644); err == nil {
			generatedFindings := runDafnyAudit(ctx, proofDirectory, module.Source+auditCopySuffix, string(generated))
			_ = os.Remove(copied)
			writtenFindings := runDafnyAudit(ctx, proofDirectory, module.Source+".dfy", string(written))
			findings = append(findings, auditAssumptions(module.Source, module.Functions, info, writtenFindings, generatedFindings)...)
		}
	}
	reportProofAudit(module, findings, report)
	return len(findings) == 0
}

// reportProofAudit reports findings, each at its function's name, or at the
// module's first root.
func reportProofAudit(module ProofModule, findings []proofAuditFinding, report func(*ast.Diagnostic)) {
	for _, finding := range findings {
		at := module.Roots[0]
		if finding.function != nil {
			at = finding.function.ProofDeclaration
		}
		report(proveDiagnostic(at.File, at.Node.Name(), finding.message, finding.args...))
	}
}

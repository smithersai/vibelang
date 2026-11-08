package vibelangfuzz

import "testing"

// Appendix A's RejectedMember is "a ClassElement or a TypeScript TypeMember
// (a call or construct signature) that is not a PropertySignature,
// MethodSignature, KeyMember or DefaultMember", which parses and is then
// rejected by a static rule. An index signature, a construct signature and a
// definitely assigned field are such members, so a service body that writes
// them derives and the compiler's rejection is the static rule's.
func TestGrammarAdmissionServiceRejectedMembers(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	valid := []string{
		"service S { static readonly key = \"s/S\"; read(): number; [name: string]: unknown }",
		"service S { static readonly key = \"s/S\"; new (n: number): S; n: number }",
		"service S { static readonly key!: string; n: number }",
		"service S { static readonly key = \"s/S\"; n!: number }",
	}
	invalid := []string{
		"service S { static readonly key = \"s/S\"; [name: string] }",
		"service S { static readonly key = \"s/S\"; new (: number; n: number }",
	}
	vl := grammarParseMode{prose: true, names: true}
	for _, source := range valid {
		if lab.read(lab.g, grammarLexSource(source), vl).count == 0 {
			t.Errorf("rejected member shape has no derivation: %q", source)
		}
	}
	for _, source := range invalid {
		if lab.read(lab.g, grammarLexSource(source), vl).count != 0 {
			t.Errorf("malformed member derives: %q", source)
		}
	}
	w := NewWorkspace(t)
	for _, source := range append(valid, invalid...) {
		t.Run(source, func(t *testing.T) {
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}

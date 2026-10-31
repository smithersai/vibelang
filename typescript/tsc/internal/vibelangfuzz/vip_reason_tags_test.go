package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestCanonicalVIPExitRejectsInvalidReasonTags(t *testing.T) {
	for _, tag := range []string{`null`, `true`, `7`, `"Other"`, `[]`, `{}`} {
		for _, container := range []string{"top", "exit", "cause", "reason"} {
			t.Run(container+"/"+tag, func(t *testing.T) {
				defer func() {
					if p := recover(); p != nil {
						t.Errorf("invalid reason tag panicked instead of returning an encoding error: %v", p)
					}
				}()
				reason := fmt.Sprintf(`{"_tag":%s,"error":null}`, tag)
				failure := `{"_tag":"Failure","reasons":[` + reason + `]}`
				input := failure
				switch container {
				case "exit":
					input = `{"_tag":"Success","value":{"$exit":` + failure + `}}`
				case "cause":
					input = `{"_tag":"Success","value":{"$cause":[` + reason + `]}}`
				case "reason":
					input = `{"_tag":"Success","value":{"$reason":` + reason + `}}`
				}
				if _, err := CanonicalVIPExit(json.RawMessage(input)); err == nil {
					t.Fatalf("accepted invalid reason tag: %s", input)
				}
				valid := VIPOutcome{Kind: "exit", Exit: json.RawMessage(`{"_tag":"Success","value":null}`)}
				invalid := VIPOutcome{Kind: "exit", Exit: json.RawMessage(input)}
				if aspect, _ := VIPCompare(valid, invalid); aspect != "encoding" {
					t.Fatalf("malformed encoding reported %q instead of encoding", aspect)
				}
			})
		}
	}
}

func TestCanonicalVIPExitReasonTagControls(t *testing.T) {
	for _, reason := range []string{`{"_tag":"Fail","error":null}`, `{"_tag":"Die","defect":{"$number":"-0"}}`, `{"_tag":"Interrupt","fiberId":{"$fiber":42}}`} {
		input := `{"_tag":"Failure","reasons":[` + reason + `]}`
		if _, err := CanonicalVIPExit(json.RawMessage(input)); err != nil {
			t.Fatalf("rejected valid reason: %s: %v", input, err)
		}
	}
	for _, reason := range []string{`null`, `[]`, `7`, `{"_tag":"Fail"}`, `{"_tag":"Die","defect":1,"extra":0}`} {
		input := `{"_tag":"Failure","reasons":[` + reason + `]}`
		if _, err := CanonicalVIPExit(json.RawMessage(input)); err == nil {
			t.Fatalf("accepted invalid reason shape: %s", input)
		}
	}
}

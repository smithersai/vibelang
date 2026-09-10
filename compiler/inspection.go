package compiler

import (
	"bytes"
	"encoding/json"
	"errors"

	"github.com/smithersai/vibelang/compiler/wirejson"
)

// These fields are syntax facts, not optional hints. In particular a missing
// name is not interchangeable with an explicitly anonymous function. Validate
// the nullable fields before encoding/json collapses missing and null to nil.
func (binding *DeclarationBinding) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if wirejson.Decode(bytes.NewReader(raw), &fields) != nil || len(fields) != 4 ||
		fields["kind"] == nil || bytes.Equal(fields["kind"], []byte("null")) ||
		fields["name"] == nil || fields["nameSpan"] == nil || !sdkRequiredFields(fields["span"], "start", "length") {
		return errors.New("invalid declaration binding fields")
	}
	if !bytes.Equal(bytes.TrimSpace(fields["nameSpan"]), []byte("null")) && !sdkRequiredFields(fields["nameSpan"], "start", "length") {
		return errors.New("invalid declaration name span fields")
	}
	type plain DeclarationBinding
	var value plain
	if err := wirejson.Decode(bytes.NewReader(raw), &value); err != nil {
		return err
	}
	*binding = DeclarationBinding(value)
	return nil
}

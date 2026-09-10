// Package wirejson keeps the compiler's JSON transport lossless for Unicode.
// encoding/json otherwise replaces invalid UTF-8 and unpaired UTF-16 escapes
// with U+FFFD, silently changing source text, paths, options and identities.
package wirejson

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"unicode/utf8"
)

// Validate rejects malformed JSON and Unicode before ordinary JSON decoding
// can repair it. Escaped surrogate PAIRS and literal U+FFFD are valid; a source
// containing the ASCII characters `\ud800` is valid too (its JSON has `\\`).
func Validate(raw []byte) error {
	if !utf8.Valid(raw) {
		return errors.New("compiler JSON contains invalid UTF-8")
	}
	if !json.Valid(raw) {
		return errors.New("invalid compiler JSON")
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		// JSON validity guarantees that an escape is in a string and complete.
		i++
		if raw[i] != 'u' {
			continue
		}
		unit := hexUnit(raw[i+1 : i+5])
		i += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return errors.New("compiler JSON contains an unpaired UTF-16 surrogate")
		}
		if unit >= 0xd800 && unit <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return errors.New("compiler JSON contains an unpaired UTF-16 surrogate")
			}
			next := hexUnit(raw[i+3 : i+7])
			if next < 0xdc00 || next > 0xdfff {
				return errors.New("compiler JSON contains an unpaired UTF-16 surrogate")
			}
			i += 6
		}
	}
	return nil
}

// ValidateUnique additionally checks identity-bearing JSON before decoding can
// discard repeated (including escaped-alias) fields. It is opt-in: ordinary
// compiler transport and source-JSON language semantics are unchanged. Callers
// own the byte limit; this walk is bounded to 256 levels and 100,000 values.
func ValidateUnique(raw []byte) error {
	if err := Validate(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	visited := 0
	var walk func(int) error
	walk = func(depth int) error {
		visited++
		if depth > 256 || visited > 100_000 {
			return errors.New("unique JSON traversal budget exceeded")
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		if token != json.Delim('{') && token != json.Delim('[') {
			return nil
		}
		seen := make(map[string]bool)
		for decoder.More() {
			if token == json.Delim('{') {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok || seen[key] {
					return errors.New("duplicate JSON object field")
				}
				seen[key] = true
			}
			if err := walk(depth + 1); err != nil {
				return err
			}
		}
		_, err = decoder.Token() // Validate has already checked the matching delimiter.
		return err
	}
	return walk(0)
}

func hexUnit(raw []byte) uint16 {
	var value uint16
	for _, digit := range raw {
		value <<= 4
		switch {
		case digit >= '0' && digit <= '9':
			value |= uint16(digit - '0')
		case digit >= 'a' && digit <= 'f':
			value |= uint16(digit - 'a' + 10)
		case digit >= 'A' && digit <= 'F':
			value |= uint16(digit - 'A' + 10)
		}
	}
	return value
}

// Decode accepts exactly one value with no unknown fields. The raw-message
// step preserves escapes until validation; decoding into strings first is too
// late. Callers own the input byte limit and any operation-specific budgets.
func Decode(reader io.Reader, into any) error {
	decoder := json.NewDecoder(reader)
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("expected one JSON request value")
	}
	if err := Validate(raw); err != nil {
		return err
	}
	checked := json.NewDecoder(bytes.NewReader(raw))
	checked.DisallowUnknownFields()
	return checked.Decode(into)
}

// Marshal is for serializable compiler request data, not arbitrary objects.
// Validate Go strings BEFORE encoding/json can repair them, and validate raw
// JSON supplied by any custom marshaler after encoding as well. Binary byte
// slices are base64 payloads, not UTF-8 source strings.
func Marshal(value any) ([]byte, error) {
	if err := validStrings(reflect.ValueOf(value), 0); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if err := Validate(raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// Encode writes one validated response. No successful response may silently
// substitute U+FFFD for an unrepresentable compiler-produced string either.
func Encode(writer io.Writer, value any) error {
	raw, err := Marshal(value)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	n, err := writer.Write(raw)
	if err == nil && n != len(raw) {
		return io.ErrShortWrite
	}
	return err
}

func validStrings(value reflect.Value, depth int) error {
	if depth > 512 {
		return errors.New("compiler JSON value is cyclic or exceeds its 512-level validation budget")
	}
	if !value.IsValid() {
		return nil
	}
	switch value.Kind() {
	case reflect.String:
		if !utf8.ValidString(value.String()) {
			return errors.New("compiler JSON value string contains invalid UTF-8")
		}
	case reflect.Interface, reflect.Pointer:
		if !value.IsNil() {
			return validStrings(value.Elem(), depth+1)
		}
	case reflect.Slice, reflect.Array:
		if value.Type().Elem().Kind() == reflect.Uint8 {
			return nil
		}
		for i := 0; i < value.Len(); i++ {
			if err := validStrings(value.Index(i), depth+1); err != nil {
				return err
			}
		}
	case reflect.Map:
		entries := value.MapRange()
		for entries.Next() {
			if err := validStrings(entries.Key(), depth+1); err != nil {
				return err
			}
			if err := validStrings(entries.Value(), depth+1); err != nil {
				return err
			}
		}
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			field := value.Type().Field(i)
			if field.PkgPath != "" || field.Tag.Get("json") == "-" {
				continue
			}
			if err := validStrings(value.Field(i), depth+1); err != nil {
				return fmt.Errorf("%s: %w", field.Name, err)
			}
		}
	}
	return nil
}

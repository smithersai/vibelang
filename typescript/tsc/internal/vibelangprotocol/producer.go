// Package vibelangprotocol defines shared compiler-to-runtime protocol
// identifiers and key validation helpers used across compiler backends.
package vibelangprotocol

import "strings"

// ProducerQueueKey identifies the private queue service used by the runtime's
// yield helpers. Both compiler backends supply it around a native callback.
const ProducerQueueKey = "vibelang-runtime/ProducerQueue"

// RuntimeNamespace is the canonical namespace prefix for internal VibeLang
// runtime protocol service keys.
const RuntimeNamespace = "vibelang-runtime"

// ParseServiceKey splits a canonical "namespace/Symbol" service key into its
// namespace and symbol parts, reporting false for malformed keys.
func ParseServiceKey(key string) (namespace string, symbol string, ok bool) {
	if key == "" || strings.ContainsAny(key, " \t\r\n\"'`\\") {
		return "", "", false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < 0x21 || key[i] > 0x7e {
			return "", "", false
		}
	}
	ns, sym, found := strings.Cut(key, "/")
	if !found || ns == "" || sym == "" || strings.Contains(sym, "/") {
		return "", "", false
	}
	if !isValidNamespaceSegment(ns) || !isValidSymbolSegment(sym) {
		return "", "", false
	}
	return ns, sym, true
}

// IsValidServiceKey reports whether key conforms to the canonical
// "namespace/Symbol" runtime protocol key syntax.
func IsValidServiceKey(key string) bool {
	_, _, ok := ParseServiceKey(key)
	return ok
}

// FormatServiceKey constructs a canonical protocol service key from namespace
// and symbol, returning ok=false if either segment is invalid.
func FormatServiceKey(namespace, symbol string) (string, bool) {
	candidate := namespace + "/" + symbol
	if !IsValidServiceKey(candidate) {
		return "", false
	}
	return candidate, true
}

func isValidNamespaceSegment(s string) bool {
	if s == "" || s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '@' || c == '.') {
			return false
		}
	}
	return true
}

func isValidSymbolSegment(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		isLetter := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
		isDigit := c >= '0' && c <= '9'
		if i == 0 && !(isLetter || c == '_' || c == '$') {
			return false
		}
		if !(isLetter || isDigit || c == '_' || c == '$') {
			return false
		}
	}
	return true
}

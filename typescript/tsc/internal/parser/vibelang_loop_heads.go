package parser

// The grammar ownership belongs to VIP-19 and VIP-20, even when recovery
// consumes a declaration that native TypeScript permits in a loop head.
const ConcurrentHeadDiagnosticCode int32 = 1906
const ConcurrentHeadDiagnosticText = "for concurrent declares its element with const or let; write for concurrent (const v of xs) { x = v } to assign an existing variable."
const StreamHeadDiagnosticCode int32 = 2005
const StreamHeadDiagnosticText = "for try declares its element with const or let; write for try (const v of s) { x = v } to assign an existing variable."

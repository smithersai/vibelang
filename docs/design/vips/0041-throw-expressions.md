# VIP-41: TC39 throw expressions

**Status:** accepted by Will, 2026-11-02.

## Will's words

> "Refer to tc39 spec for answer"

Recorded in `WILL-ANSWERS.md`, 2026-11-02. As with VIP-2's do expressions, adopt the proposal text exactly for grammar, precedence and positions requiring parentheses.

## Decision

The normative reference is the [vendored TC39 throw-expressions specification](tc39-throw-expressions/README.md), pinned to `tc39/proposal-throw-expressions` commit `78b887751db4e380870a0a6bfc47319c50aa1404` (2024-01-19). Appendix A imports its unary production, invalid-punctuator lookahead and expression-statement restriction.

A throw expression takes a unary operand and is itself a unary expression. Parentheses around the operand allow a compound value: `x ?? throw (a + b)`. Parentheses around the throw allow it before another operator: `(throw e) + b`. A following comma is forbidden too: write `f((throw e), b)` or `[a, throw e]`. The restriction is lexical: `in` and `instanceof` are absent from the invalid-punctuator list. TypeScript's `as` and `satisfies` are also absent and retain their ordinary grammar. A statement starting with `throw` remains a throw statement, with its full expression operand and no-line-terminator restriction. An expression-position `throw` has no such line-terminator restriction. ECMAScript automatic semicolon insertion still applies.

Throw expressions remain supported; no migration to `do { throw (operand); }` is required. Existing `do` blocks remain valid.

The existing `EK1010` identifies a throw-expression lookahead violation. Native ECMAScript syntax restrictions keep their existing diagnostics. No new code is allocated outside the EK registry.

## Existing placement and match-arm rules

Where a throw is allowed at all is **not this VIP's decision**. [VIP-4's no-throw rule](0004-throw.md) (`EK0401`) decides that. In effect code a throw fails the Effect, exactly as the corresponding throw statement does. Grammar acceptance does not grant permission to throw from a plain function or from eager parameter initialization.

VIP-7's direct match-arm body has its separate `"throw" Expression` production: `default: throw a + b;` throws the full operand, as a throw statement does. A throw expression nested within an arm still follows VIP-41.

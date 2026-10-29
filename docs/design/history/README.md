# Historical design documents

**Historical, not normative.** Nothing here is part of the VibeLang language. The language is what the accepted VibeLang Improvement Proposals in [`../vips/`](../vips/README.md) define, and the specification in [`../src/`](../src/000-intro.md) states it.

This directory keeps, as reference material:

- `src/`: the previous specification (chapters 1 to 30 and appendices A to C), as it stood on 2026-10-29 before the rewrite from the VIPs.
- `DECISIONS.md`: the previous decision log, `D1` to `D558`. VIPs cite its decisions in their "Footnote: old VibeLang" sections.

The compiler is still being changed to match the VIPs. Until it is, these documents describe much of what the compiler does today, including its diagnostic registry (`src/428-part4-ch28-tooling.md`), which its tests check.

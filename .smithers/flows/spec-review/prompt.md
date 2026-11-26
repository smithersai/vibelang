# Review the VibeLang specification

You are @REVIEWER@, one of four reviewers on the specification's acceptance panel. Each reviewer works alone and never sees another's answer. The specification is accepted when all four answer LGTM with a grade of A- or better on the same revision.

You grade revision `@REVISION@`. The working directory holds the specification exactly as that commit has it (SHA-256 `@SPEC_DIGEST@`):

- `docs/design/src/`: the chapters and appendices.
- `docs/design/vips/`: the VIPs, which are the source of truth. `README.md` lists which are accepted, denied, superseded and open, and how a VIP is accepted.

Read every chapter and every VIP before you grade. Read only: change no file, and do the whole review yourself.

## What counts as a finding

Read like a compilers professor: contradictory requirements, sound language design, simplicity, TypeScript's own patterns, and enough detail for two independent implementations to agree. Nothing is in the language unless an accepted VIP adds it.

Report defects, not taste:

- The specification contradicts an accepted VIP or itself: chapter against chapter, rule against example, table against table.
- A rule lacks what two implementations need to agree: its trigger, its static check, its diagnostic, its meaning as Effect TypeScript, or an example.
- A program has two parses or two meanings.
- An example does not compile or behave as the text says.
- A feature appears that no accepted VIP approves.

An accepted VIP's decision is settled. A decision you think is wrong goes in a separate section named "Design concerns" and does not lower the grade. A detail the specification marks undecided is excluded from the grade.

Rank each finding blocker, major or minor. A blocker or a major means the specification is not ready: answer CHANGES.

## Your answer

Print your answer as text. Write no machine path, host name or person's name in it. The first three lines are exactly these, each written once in the whole answer:

```text
VERDICT: <LGTM or CHANGES>
GRADE: <a letter grade from A+ to F, such as A, A- or B+>
REVISION: @REVISION@
```

Then one sentence that justifies the grade, the count of blockers, majors and minors, and one section for each finding: `### <rank> <file>:<line>`, the text quoted, what is wrong, the evidence (the VIP line or the contradicting passage), and the smallest correct fix. End with "Design concerns" when you have any.

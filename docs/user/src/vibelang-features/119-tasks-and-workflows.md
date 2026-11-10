# Durable tasks and workflows

A `task` is one recorded step of a durable run, and a `workflow` is a plan over tasks. Both are written like a `service`: a class-shaped body with one `effect call` method and `static readonly` options. They are experimental: declarations parse, type-check and format, and running a workflow needs a durable engine, the `DurableEngine` service, which no package provides yet.

```vibe
schema Issue { number: number; title: string }

task FetchIssues {
  static readonly retryPolicy = { initialMs: 1000, factor: 2, maxMs: 4000, maxAttempts: 3 }
  effect call(repo: string): ReadonlyArray<Issue>!string {
    if (repo === "") throw "no repository"
    return [{ number: 1, title: repo }]
  }
}

export workflow Triage {
  effect call(repo: string) {
    const issues = try FetchIssues(repo)
    return issues.length
  }
}
```

## Tasks

- A task's `call` writes a type for every parameter and an `A!E` return type. That annotation is the step's boundary: the body is checked against `A` and `E`, and the services the body reads belong to the task's implementation, not to its callers. The `R` slot is never written.
- A `call` without a body declares a step whose implementation is supplied separately: `effect call(order: Order): Receipt!Declined`.
- Each parameter type and the `A` and `E` of the annotation need a schema form, as a `schema` field's type does: `string`, a `schema` declaration, `Date`, `ReadonlySet<T>` and the other mapped types. A type without one, such as `Set<string>`, `unknown` or a plain type alias, is `EK2109`. The derived schemas are on the declaration: `FetchIssues.schemas.payload` holds one schema per parameter, and `schemas.success` and `schemas.error` hold the annotation's.
- Each `static readonly` member is an option, passed through under its own name. `static readonly key = "billing/Charge"` replaces the declared name.
- A task runs only as a step of a workflow. Calling one anywhere else, even inside an `effect` block in a workflow, is `EK5502`.

## Workflows

- A workflow's `call` may leave out its return type: its success and error come from the steps it runs.
- `try Triage("smithersai/smithers")` runs the workflow to completion. Its type requires `DurableEngine`, so a program that runs a workflow without an engine has a missing requirement.

## Rules

- A `task` or `workflow` body holds one non-static `effect call` method and `static readonly` members with initializers. Anything else, such as a second `call`, an instance field or a type parameter, is `EK5501`.
- `task` and `workflow` are contextual keywords. They start a declaration only at the start of a statement, followed on the same line by a name, so `const task = 1`, `task as Job` and `workflow.run()` keep their TypeScript meaning.

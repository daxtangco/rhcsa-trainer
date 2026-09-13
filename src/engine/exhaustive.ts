/**
 * Compile-time exhaustiveness for a list that enumerates a union.
 *
 * There are two shapes in this codebase and they are not interchangeable:
 *
 * - **Unordered membership** — `Record<Union, true>`, as in `vm/config.ts`'s
 *   `KINDS`, `server/app.ts`'s `MODES`, `grading/verdict.ts`'s `STATUSES` and
 *   `content/task.ts`'s `SCOPES` / `WEIGHTS` / `TRANSPORTS`. A missing member is a
 *   missing property, so the object literal itself fails to typecheck, and
 *   `Object.keys` gives every accepted value to the error message for free. This
 *   is the better shape and is the default.
 * - **Ordered sequence** — a `readonly` tuple plus `EveryMemberListed` below, for
 *   the two lists whose *order* is part of what they mean. A record cannot carry
 *   that: key order is an implementation detail of the literal, and a hint ladder
 *   whose reading order depends on object key ordering is a worse guarantee than
 *   the array it replaced. So the array stays and the exhaustiveness is bolted on.
 *
 * The mechanism is a **type parameter constraint**, which is the only kind of check
 * that runs once per instantiation. Nothing here emits runtime code — these are type
 * aliases, erased before Node sees them, which is why an unused alias at a use site
 * is the intended shape rather than dead code.
 *
 * The list must be captured with `as const` for any of this to work. `readonly
 * Rung[]` widens every element back to `Rung`, which makes
 * `Exclude<Rung, (typeof RUNGS)[number]>` unconditionally `never` — an assertion
 * that passes whatever the contents. That widening annotation was one defect; the
 * one below was the other.
 *
 * ## The vacuous version, and why it could not work
 *
 * This file used to read:
 *
 * ```ts
 * type AssertNever<T extends never> = T
 * export type EveryMemberListed<Union, Listed extends Union> = AssertNever<Exclude<Union, Listed>>
 * ```
 *
 * `tsc` reported one error on the second line — *"Type 'Exclude<Union, Listed>' does
 * not satisfy the constraint 'never'"* — and that error was the whole guard failing,
 * not a nuisance to be suppressed. A constraint on a type reference inside an alias
 * **body** is checked exactly once, where it is written, against the alias's own
 * unresolved type parameters. `Exclude<Union, Listed>` there is a deferred
 * conditional type over a naked parameter, so it is never assignable to `never` and
 * the check fails at the declaration; and TypeScript does not re-run it per
 * instantiation, so no use site was ever checked at all. Measured on this compiler
 * (typescript 5.8): with the old code, `EveryMemberListed<1 | 2 | 3, 1 | 2>` produced
 * **no error** — the missing member `3` was reported nowhere. Both call sites,
 * `ladder.ts`'s `RUNGS` and `validate/expectations.ts`'s `PHASES`, were unguarded
 * while a red typecheck made the file look guarded twice over.
 *
 * ## Why the check hangs off `Listed`'s constraint
 *
 * Type *parameter* constraints, unlike references in a body, are instantiated and
 * checked at every use. `Listed` is therefore constrained twice over:
 *
 * - `Union` — the old direction, rejecting a listed value that is not in the union.
 * - `[Union] extends [Listed] ? unknown : MembersMissingFromTheList<...>` — the
 *   direction that was missing. When the list is complete this is `unknown`, the
 *   intersection collapses to `Union`, and `Listed` satisfies it. When a member is
 *   left out the branch resolves to an object type nothing in the union is
 *   assignable to, so `tsc --noEmit` fails **at the use site** and prints the
 *   missing members inside `MembersMissingFromTheList<...>`.
 *
 * The tuple wrappers in `[Union] extends [Listed]` are load-bearing: a bare
 * `Union extends Listed` distributes over the union and asks the question one member
 * at a time, which is not the question. Writing the whole thing as one constraint on
 * `Listed`, rather than as a third parameter with a computed default, is also
 * deliberate — a defaulted parameter's default is checked against its constraint at
 * the declaration, with the same unresolved parameters, which reproduces exactly the
 * vacuous error above. Both alternatives were tried against 5.8 before this one.
 */
type MembersMissingFromTheList<Missing> = {
  readonly __membersMissingFromTheList: Missing
}

/**
 * `Listed`, when `Listed` covers `Union`; a constraint violation naming the missing
 * members otherwise. Both directions, in one constraint: a listed value that is not
 * in the union fails against `Union`, and a union member nothing lists fails against
 * `MembersMissingFromTheList`.
 *
 * Use as `type _EveryFooIsListed = EveryMemberListed<Foo, (typeof FOOS)[number]>`.
 * The result type is not the point and is never read — the check is the constraint,
 * so the alias exists only to make `tsc` instantiate it.
 */
export type EveryMemberListed<
  Union,
  Listed extends Union &
    ([Union] extends [Listed] ? unknown : MembersMissingFromTheList<Exclude<Union, Listed>>),
> = Listed

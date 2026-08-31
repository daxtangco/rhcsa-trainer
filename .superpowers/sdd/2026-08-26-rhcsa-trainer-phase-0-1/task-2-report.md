# Task 2 Report: `LabTransport` interface and `FakeTransport`

## What was implemented

Exactly the brief's Step 3 code, verbatim, in three new files:

- `src/engine/vm/transport.ts` — `TransportKind` union (`'ssh' | 'vmrun' | 'fake'`), `ExecResult` interface (`stdout`, `stderr`, `code`), `LabTransport` interface (`kind`, `exec(script): Promise<ExecResult>`, `isAvailable(): Promise<boolean>`).
- `src/engine/vm/fake.ts` — `FakeHandler` type (`(script: string) => ExecResult | Promise<ExecResult>`, full `ExecResult`, not `Partial` — per settled decision 1) and `FakeTransport implements LabTransport`, constructor `(handler: FakeHandler, opts?: { available?: boolean })`, public `calls: string[]`, private `#handler`/`#available` fields (ECMAScript private fields — erasable, not TS parameter properties).
- `src/engine/content/errors.ts` — `ContentError extends Error` with `where: string`, `problems: string[]`, aggregating message.
- `test/fake-transport.test.ts` — the brief's 5 tests, unchanged, at the top-level `test/` path (per settled decision 2, not `test/vm/`).

No deviation from the brief's specified shapes, signatures, or filenames.

## TDD evidence

### RED

Command:
```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/fake-transport.test.ts
```

Output:
```
 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer


⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/fake-transport.test.ts [ test/fake-transport.test.ts ]
Error: Cannot find module '../src/engine/vm/fake.ts' imported from '/home/daxtangco/rhcsa-trainer/test/fake-transport.test.ts'
 ❯ test/fake-transport.test.ts:2:1
      1| import { describe, expect, it } from 'vitest'
      2| import { FakeTransport } from '../src/engine/vm/fake.ts'
       | ^
      3|
      4| describe('FakeTransport', () => {

Caused by: Error: Failed to load url ../src/engine/vm/fake.ts (resolved id: ../src/engine/vm/fake.ts) in /home/daxtangco/rhcsa-trainer/test/fake-transport.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/config.js:22739:33

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  22:06:21
   Duration  538ms (transform 75ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 144ms)
```

This is exactly the expected failure from the brief's Step 2: `src/` did not yet exist (confirmed by `ls src` failing before starting), so the import target was genuinely missing — not a typo or config problem.

### GREEN

Command:
```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/fake-transport.test.ts
```

Output (after implementation):
```
 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer

 ✓ test/fake-transport.test.ts (5 tests) 7ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  22:07:09
   Duration  564ms (transform 58ms, setup 0ms, collect 46ms, tests 7ms, environment 0ms, prepare 104ms)
```

Full suite + typecheck:
```
cd /home/daxtangco/rhcsa-trainer && npm test
> rhcsa-trainer@0.1.0 test
> vitest run

 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer

 ✓ test/scaffold.test.ts (2 tests) 5ms
 ✓ test/fake-transport.test.ts (5 tests) 6ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
   Start at  22:07:17
   Duration  540ms

cd /home/daxtangco/rhcsa-trainer && npm run typecheck
> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit

(no output — clean exit)
```

7/7 total tests pass (2 scaffold + 5 new); typecheck exits silently, as expected.

### Extra sanity check: no-build-step constraint

Ran the implementation directly with `node` (no `tsx`, no compile step) to confirm the "erasable syntax only" constraint truly holds at runtime, not just under `tsc`:

```
node -e "
import('./src/engine/vm/fake.ts').then(async (m) => {
  const t = new m.FakeTransport(() => ({ stdout: 'ok', stderr: '', code: 0 }));
  console.log(await t.exec('true'));
  console.log(t.kind);
});
"
```
Output:
```
{ stdout: 'ok', stderr: '', code: 0 }
fake
```
Confirms the `#handler`/`#available` private fields (standard ECMAScript private fields, not TS parameter properties) strip and run cleanly under Node's native TypeScript support.

## Files changed

- `src/engine/vm/transport.ts` (new)
- `src/engine/vm/fake.ts` (new)
- `src/engine/content/errors.ts` (new)
- `test/fake-transport.test.ts` (new)

## Self-review

Read the diff (`git show HEAD`) fresh against the brief line by line:

- **Field/signature names**: `ExecResult{stdout,stderr,code}`, `LabTransport{kind,exec,isAvailable}`, `TransportKind = 'ssh'|'vmrun'|'fake'`, `FakeTransport` constructor `(handler: FakeHandler, opts?: {available?: boolean})`, `calls: string[]`, `FakeHandler = (script: string) => ExecResult | Promise<ExecResult>`, `ContentError{where,problems}` — all match the brief verbatim, no renaming or shape drift.
- **`FakeHandler` returns full `ExecResult`, not `Partial`** — confirmed as written; no defaulting logic was added to `exec`. Matches settled decision 1.
- **Test file location** — `test/fake-transport.test.ts` at top level, not `test/vm/`. Matches settled decision 2.
- **Do tests verify behavior or mirror implementation?** Test 2 ("returns the handler's result unchanged") checks deep equality against a literal object, independent of implementation internals. Test 5 exercises a genuinely stateful handler across three sequential `exec` calls and checks the observable transitions — this exercises real behavior (call recording + handler delegation), not just re-stating what the code does. None of the five tests assert on private state or implementation details.
- **Overbuilt beyond the brief?** No extra methods, no defaulting, no helper exports beyond what's specified. `ContentError`'s constructor message format matches the brief's code exactly (not embellished).
- **Test output pristine** — no warnings, no console noise, no unhandled promise messages in any of the three runs above.
- **Erasable syntax** — no `enum`, no `namespace`, no parameter properties, no decorators. `FakeTransport` uses ECMAScript private fields (`#handler`, `#available`) with explicit constructor assignment, exactly per the Global Constraints guidance and the brief's own comment in `fake.ts`.
- **Import extensions / verbatim module syntax** — `fake.ts` imports `type { ExecResult, LabTransport, TransportKind }` from `./transport.ts` with the `.ts` extension and `type` keyword, satisfying `verbatimModuleSyntax`.

No discrepancies found. Nothing needed correction.

## Concerns

None. Task went exactly to plan — RED for the right reason, GREEN with no incidental fixes needed, typecheck clean on the first attempt, and the two previously-settled decisions (full `ExecResult` in `FakeHandler`, and the flat test path) were followed as instructed without re-litigating them.

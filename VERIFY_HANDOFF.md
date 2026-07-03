# Dark Factory Verify Repair Handoff

## Mission
Repair this existing codebase after Dark Factory Verify found 3 discrepancy(s).

This is not a fresh product interview, not a new scaffold, and not a sibling repair project. The verifier already scanned the returned codebase and produced the findings below. Your job is to fix this codebase in place, preserve the existing scaffold contract, prove the repairs, and return the same workspace to Verify.

## Authority
- `VERIFY_HANDOFF.md` is the active task handoff.
- Existing project files remain authoritative for product intent: `AGENTS.md`, `HANDOFF.md`, `feature_list.json`, `docs/product_constitution.md`, `docs/intent_ledger.md`, `docs/acceptance_contract.json`, `docs/verification.md`, `verification/traceability.md`, `verification/final_gauntlet.md`, and feature evidence files.
- The local post-build gauntlet below is the verifier's failure report. Every discrepancy is a MUST-fix item.

## Operating Rules
- Do not generate a sibling repair scaffold.
- Do not re-plan the entire product unless a verifier discrepancy proves the existing plan is internally inconsistent.
- Read the relevant scaffold files and source before editing.
- Fix every item under `Batched Discrepancies For Coders`.
- Preserve behavior that already passes.
- Prefer the smallest correct changes that repair the failed contract.
- Update tests, traceability, evidence, docs/current_state.md if present, and any affected feature documentation.
- Remove stale code, placeholders, dead controls, fake-success paths, and abandoned experiments you touch.
- Run `bash verify.sh` before stopping. If it cannot run, record the exact blocker and the closest executable proof.

## Repair Loop
1. Rebrief from this file plus the existing project instructions and verification docs.
2. Reproduce or inspect each discrepancy before changing code.
3. Repair the codebase in place.
4. Add or update tests that would have caught the discrepancy.
5. Update traceability and feature evidence with commands, results, changed paths, and known gaps.
6. Run `bash verify.sh`.
7. Do a regression pass over passing checks so the repair does not break completed work.

## Completion Criteria
- Every verifier discrepancy below is fixed or has a documented hard blocker.
- `bash verify.sh` exits 0, or the blocker is concrete and reproducible.
- Verification evidence records the final command output.
- Traceability maps affected entry points and acceptance criteria to implementation and tests.
- The same codebase is ready to return to the Dark Factory Verify tab.

## Verifier Findings

=== DARK FACTORY VERIFY SUMMARY ===

Result: FAIL - 3 batched discrepancy(s).

Dark Factory ran the local scaffold/code gauntlet first, then ran the graphical visual QA phase when the workspace and local environment supported it.

=== LOCAL POST-BUILD GAUNTLET ===

Codebase under verification: /home/reid/projects/atlas-workbench
Scaffold contract: auto-detected from required Dark Factory files in the selected codebase.

Result: FAIL - 2 batched discrepancy(s).

## Batched Discrepancies For Coders

1. Severity: CRITICAL
   Area: Dark Factory scaffold files
   Evidence: Missing required files: docs/agent_constitution.md, docs/current_state.md, docs/team_protocol.md, docs/work_decomposition.json, docs/work_decomposition.md
   Required fix: Restore the generated operating files or explain why the final codebase moved them and update the handoff accordingly.

2. Severity: CRITICAL
   Area: Generated scaffold contract validation
   Evidence: - missing required files: docs/agent_constitution.md, docs/current_state.md, docs/team_protocol.md, docs/work_decomposition.json, docs/work_decomposition.md
- AGENTS.md: missing rebrief gate
- AGENTS.md: missing no blind edits
- AGENTS.md: missing docs/current_state.md
- AGENTS.md: missing docs/team_protocol.md
- HANDOFF.md: missing rebrief gate
- HANDOFF.md: missing work_decomposition
- HANDOFF.md: missing feature cell
- HANDOFF.md: missing docs/current_state.md
- HANDOFF.md: missing no blind edits
- docs/agent_constitution.md: missing rebrief gate
- docs/agent_constitution.md: missing no blind edits
- docs/agent_constitution.md: missing cleanup rule
- docs/agent_constitution.md: missing docs/current_state.md
- docs/current_state.md: missing rebrief gate checklist
- docs/current_state.md: missing active work
- docs/current_state.md: missing feature cells
- docs/current_state.md: missing cleanup notes
- docs/team_protocol.md: missing architect
- docs/team_protocol.md: missing tribunal
- docs/team_protocol.md: missing feature cell
- docs/team_protocol.md: missing integration gate
- docs/work_decomposition.md: missing architect
- docs/work_decomposition.md: missing tribunal
- docs/work_decomposition.md: missing feature cells
- docs/work_decomposition.md: missing shared contracts
- prompts/implementer.txt: missing rebrief gate
- prompts/implementer.txt: missing docs/current_state.md
- prompts/implementer.txt: missing cleanup
- prompts/implementer_retry.txt: missing rebrief
   Required fix: Repair the completed codebase so it still satisfies the generated Dark Factory scaffold contract.

## Passing Checks

- `bash init.sh` exits 0 in the completed codebase.
- `bash verify.sh` exits 0 in the completed codebase.
- Protected baseline comparison skipped: no original baseline found for this legacy or externally loaded workspace.
- Architecture dependency contract is internally valid.
- Feature count is within the generated scaffold contract range.
- Every feature in feature_list.json is marked done.
- Acceptance contract covers every feature id.
- 12 holdout scenario file(s) are present.
- Every feature has at least one holdout scenario.
- Traceability has no unfinished rows for feature ids.
- Final gauntlet checklist has no unchecked items.
- No obvious stub markers found in source files.
- No interview scratchpad or Tribunal runtime text leaked into artifacts.

## Raw init.sh Output

```text
Exit code: 0

STDOUT:
[92m✓[0m python3
[92m✓[0m bash
Environment looks ready.

STDERR:

```

## Raw verify.sh Output

```text
Exit code: 0

STDOUT:
== Dark Factory verification ==
Static scaffold and wiring-smell checks passed.

> atlas-workbench@1.0.0 test
> vitest run


 RUN  v2.1.9 /home/reid/projects/atlas-workbench

 ✓ tests/errorMapper.test.ts (7 tests) 2ms
 ✓ tests/flagBuilder.test.ts (15 tests) 10ms
 ✓ tests/controller.test.ts (7 tests) 207ms
 ✓ tests/binaryValidation.test.ts (7 tests) 8ms
 ✓ tests/config.test.ts (7 tests) 13ms
 ✓ tests/ui/SystemMonitorTab.test.tsx (4 tests) 44ms
 ✓ tests/backend.test.ts (14 tests) 291ms
 ✓ tests/processManager.test.ts (8 tests) 320ms
 ✓ tests/ui/FineTuningTab.test.tsx (2 tests) 83ms
 ✓ tests/ui/ErrorBanner.test.tsx (4 tests) 132ms
 ✓ tests/ui/ServerTab.test.tsx (6 tests) 130ms
 ✓ tests/monitor.test.ts (5 tests) 412ms
 ✓ tests/ui/App.test.tsx (4 tests) 221ms
 ✓ tests/ui/ModelsTab.test.tsx (5 tests) 239ms
 ✓ tests/ui/SettingsTab.test.tsx (8 tests) 467ms

 Test Files  15 passed (15)
      Tests  103 passed (103)
   Start at  06:31:14
   Duration  1.20s (transform 583ms, setup 547ms, collect 1.65s, tests 2.58s, environment 2.96s, prepare 1.83s)


STDERR:
stderr | tests/ui/ErrorBanner.test.tsx > ErrorBanner > shows the error title, message, plain-language fix, Retry, and Dismiss
Warning: An update to ErrorBanner inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ErrorBanner (/home/reid/projects/atlas-workbench/src/ui/components/ErrorBanner.tsx:6:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ServerTab.test.tsx > ServerTab > changing host/port updates the flags passed on next launch
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ServerTab.test.tsx > ServerTab > disables Start when running and Stop when stopped
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ErrorBanner.test.tsx > ErrorBanner > Dismiss removes the error
Warning: An update to ErrorBanner inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ErrorBanner (/home/reid/projects/atlas-workbench/src/ui/components/ErrorBanner.tsx:6:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ServerTab.test.tsx > ServerTab > disables Start when running and Stop when stopped
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ErrorBanner.test.tsx > ErrorBanner > Retry re-runs the failed operation
Warning: An update to ErrorBanner inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ErrorBanner (/home/reid/projects/atlas-workbench/src/ui/components/ErrorBanner.tsx:6:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/FineTuningTab.test.tsx > FineTuningTab > disables Stop when training is not running and Start when it is
Warning: An update to FineTuningTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at FineTuningTab (/home/reid/projects/atlas-workbench/src/ui/tabs/FineTuningTab.tsx:22:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ServerTab.test.tsx > ServerTab > streams logs into the log panel in real time
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ErrorBanner.test.tsx > Notices > shows a success notice when training completes
Warning: An update to Notices inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at Notices (/home/reid/projects/atlas-workbench/src/ui/components/Notices.tsx:6:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ModelsTab.test.tsx > ModelsTab > lists .gguf files after browsing to a directory
Warning: An update to ModelsTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ModelsTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ModelsTab.tsx:12:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ServerTab.test.tsx > ServerTab > extracts tokens/sec from llama.cpp timing logs
Warning: An update to ServerTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ServerTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ServerTab.tsx:19:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ModelsTab.test.tsx > ModelsTab > shows a message for an empty directory
Warning: An update to ModelsTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ModelsTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ModelsTab.tsx:12:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ModelsTab.test.tsx > ModelsTab > shows a clear error for a nonexistent directory
Warning: An update to ModelsTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ModelsTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ModelsTab.tsx:12:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)

stderr | tests/ui/ModelsTab.test.tsx > ModelsTab > selecting a model and clicking Load sets it as active and shows the loaded indicator
Warning: An update to ModelsTab inside a test was not wrapped in act(...).

When testing, code that causes React state updates should be wrapped into act(...):

act(() => {
  /* fire events that update state */
});
/* assert on the output */

This ensures that you're testing the behavior the user would see in the browser. Learn more at https://reactjs.org/link/wrap-tests-with-act
    at ModelsTab (/home/reid/projects/atlas-workbench/src/ui/tabs/ModelsTab.tsx:12:44)
    at AppProvider (/home/reid/projects/atlas-workbench/src/state/reactBinding.tsx:8:24)


```

=== VISUAL QA GAUNTLET ===

Status: FAIL
Result: FAIL - 1 batched discrepancy(s).
Evidence directory: /home/reid/projects/atlas-workbench/verification/visual_qa/20260703-063115
Launch target: Detected Tauri desktop app via package.json script `tauri:dev`. Running inside an offscreen Xvfb display; frames are mirrored only into the Verify tab.

## Connectivity Preflight

- llama.cpp for `server-control`: wrong-service-or-malformed http://127.0.0.1:8080/api/slots -> 200 html service_ok=False; http://127.0.0.1:8080/slots -> 200 html service_ok=False
- external service for `model-management`: unreachable
- llama.cpp for `settings-flags`: wrong-service-or-malformed http://127.0.0.1:8080/api/slots -> 200 html service_ok=False; http://127.0.0.1:8080/slots -> 200 html service_ok=False
- llama.cpp for `fine-tuning`: wrong-service-or-malformed http://127.0.0.1:8080/api/slots -> 200 html service_ok=False; http://127.0.0.1:8080/slots -> 200 html service_ok=False
- llama.cpp for `system-monitor`: wrong-service-or-malformed http://127.0.0.1:8080/api/slots -> 200 html service_ok=False; http://127.0.0.1:8080/slots -> 200 html service_ok=False
- llama.cpp for `binary-config`: wrong-service-or-malformed http://127.0.0.1:8080/api/slots -> 200 html service_ok=False; http://127.0.0.1:8080/slots -> 200 html service_ok=False
- external service for `error-handling`: unreachable

## Visual Findings

1. Severity: CRITICAL
   Area: Visual app launch
   Evidence: Detected Tauri desktop app via package.json script `tauri:dev`. Running inside an offscreen Xvfb display; frames are mirrored only into the Verify tab. Launch failed: native launch command exited with code 1 inside contained visual QA. Output:
        Info Watching /home/reid/projects/atlas-workbench/src-tauri for changes...

> atlas-workbench@1.0.0 dev
> vite

Port 5173 is in use, trying another one...
Port 5174 is in use, trying another one...
Port 5175 is in use, trying another one...

  [32m[1mVITE[22m v5.4.21[39m  [2mready in [0m[1m92[22m[2m[0m ms[22m

  [32m➜[39m  [1mLocal[22m:   [36mhttp://localhost:[1m5176[22m/[39m
[2m  [32m➜[39m  [1mNetwork[22m[2m: use [22m[1m--host[22m[2m to expose[22m
[1m[92m   Compiling[0m atlas-workbench v1.0.0 (/home/reid/projects/atlas-workbench/src-tauri)
[1m[96m    Building[0m [=======================> ] 519/521: atlas-workbench(build)
[1m[96m    Building[0m [=======================> ] 520/521: atlas-workbench(bin)
node:internal/fs/watchers:254
    const error = new UVException({
                  ^

Error: ENOSPC: System limit for number of file watchers reached, watch '/home/reid/projects/atlas-workbench/src-tauri/target/debug/.fingerprint/async-trait-07032466ab62d367/lib-async_trait'
    at FSWatcher.<computed> (node:internal/fs/watchers:254:19)
    at Object.watch (node:fs:2554:36)
    at createFsWatchInstance (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:42780:17)
    at setFsWatchListener (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:42827:15)
    at NodeFsHandler._watchWithNodeFs (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:42982:14)
    at NodeFsHandler._handleFile (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:43046:23)
    at NodeFsHandler._addToNodeFs (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:43288:21)
Emitted 'error' event on FSWatcher instance at:
    at FSWatcher._handleError (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:44481:10)
    at NodeFsHandler._addToNodeFs (file:///home/reid/projects/atlas-workbench/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:43296:18) {
  errno: -28,
  syscall: 'watch',
  code: 'ENOSPC',
  path: '/home/reid/projects/atlas-workbench/src-tauri/target/debug/.fingerprint/async-trait-07032466ab62d367/lib-async_trait',
  filename: '/home/reid/projects/atlas-workbench/src-tauri/target/debug/.fingerprint/async-trait-07032466ab62d367/lib-async_trait'
}

Node.js v22.23.1
       Error The "beforeDevCommand" terminated with a non-zero status code.
   Required fix: Fix the app launch command, package scripts, runtime dependencies, or visual_gauntlet launch target so a tester can open the product.

## Passing Visual Checks

- No passing visual checks recorded.

## Skipped Visual Checks

- none

## Launch Output

```text

```

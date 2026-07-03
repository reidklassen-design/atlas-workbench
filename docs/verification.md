# Verification Protocol

Every feature passes three gates before it is marked done.

1. Static gate: lint, type check, tests, and architecture checks pass.
2. Spec gate: implementation satisfies every MUST requirement in the spec.
3. Functional gate: scenario execution scores at least 90%.
4. Wiring gate: every user-visible command, button, route, menu item, form,
   shortcut, API endpoint, and background job introduced by the feature is
   connected to real behavior and covered by an executable test or scenario.

A feature is not done because the app launches. It is done only when the
reviewer can trace each declared behavior from spec -> implementation ->
automated test/scenario evidence. Stub handlers, placeholder callbacks,
dead buttons, uncalled functions, fake success messages, TODO behavior, and
"passes but does nothing" flows are CHANGES_REQUESTED.

Required evidence for each feature:

- The exact verification commands that were run.
- The test/scenario names that prove the feature behavior.
- A short wiring audit listing each relevant UI/API/CLI entry point and the
  function/module it reaches.
- Traceability from docs/product_constitution.md and
  docs/acceptance_contract.json to code paths and tests.
- Any known gap. If there is a known gap, the feature is not done.

Evidence is stored in verification/evidence/<feature-id>.md. The generated
verify.sh rejects any feature marked done without an evidence file, rejects
placeholder evidence, rejects missing constitution coverage, and rejects
done features with known gaps.

Retry limit: 3 implementation attempts per feature. If a feature still fails
after retries, mark it blocked with the failure evidence and continue with
independent features.

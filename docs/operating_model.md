# Dark Factory Operating Model

This project is built by an adversarial autonomous pipeline. It is not a
trust-based checklist where one agent says "done" and moves on.

## Pipeline

1. Intent Compiler: compile user language into docs/product_constitution.json and docs/product_constitution.md.
2. Blueprint QA: reject vague plans before implementation starts.
3. Acceptance Contract: convert constitutional promises into docs/acceptance_contract.json.
4. Public Test Strategy: define implementer-visible tests without leaking holdout scenarios.
5. Implementation Plan: require a plan before code for each feature.
6. Isolated Implementation: implement one feature at a time without reading scenarios/.
7. Contract Audit: prove every acceptance criterion maps to code and tests.
8. Red Team: adversarially search for fake-green behavior and broken workflows.
9. Product Owner Review: judge whether the result matches what the user actually wanted.
10. Evidence Lock: write concrete evidence before marking a feature done.
11. Final Gauntlet: verify the whole product, not just individual files.

## Rule

A green command is not proof. Only traceable evidence across constitution,
intent, acceptance, implementation, tests, reviews, and user-facing behavior
counts.

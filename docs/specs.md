# Spec Protocol

Every feature spec uses NLSpec sections: Goal, Context, Requirements,
Constraints, Edge Cases, and Non-Goals.

Implementers read only the assigned feature spec plus AGENTS.md and docs/.
They must keep feature_list.json status current and must not inspect holdout
scenario details while implementing.

docs/product_constitution.md is the highest-priority product law.
docs/acceptance_contract.json is mandatory input for every feature. If the
constitution or contract promises an entry point or behavior, the spec
implementation must include it, test it, and record evidence for it.
Missing acceptance criteria are not allowed to be treated as future work
unless the constitution/contract is updated and reviewed first.

# Review Report: system-monitor (contract-audit)

## Review

- Feature: system-monitor
- Review type: contract-audit
- Verdict: APPROVED

Verdict: APPROVED

## Evidence Checked

- Product constitution: docs/product_constitution.md ("A System Monitor tab showing real-time CPU, RAM, and GPU metrics"; GPU "not detected" assumption validation).
- Spec: specs/feature-system-monitor.md
- Acceptance contract: docs/acceptance_contract.json feature `system-monitor`
- Traceability: verification/traceability.md system-monitor rows
- Tests: tests/monitor.test.ts, tests/backend.test.ts, tests/ui/SystemMonitorTab.test.tsx
- Evidence file: verification/evidence/system-monitor.md

## Findings

- CPU and RAM metrics update at least once per second (the controller polls `monitor.collect` every 1000 ms; monitor test asserts values update over time and stay within valid ranges).
- GPU metrics display when present or a "GPU not detected" message when absent (monitor + UI tests cover both paths).
- The llama.cpp process resource usage is visible when the server is running (the controller passes running pids; monitor test asserts process CPU/memory via injected `/proc` reads; UI test asserts the process row).
- The UI does not freeze — collection is async and polled, not blocking.

## Approval Criteria

APPROVED: every contract entry point and acceptance criterion is wired to real implementation and proven by a passing test, with no constitution conflict.

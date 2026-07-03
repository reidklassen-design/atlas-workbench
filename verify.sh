#!/usr/bin/env bash
set -euo pipefail

echo "== Dark Factory verification =="
python3 - <<'PY'
import json
import re
from pathlib import Path

required = [
  "AGENTS.md", "HANDOFF.md", "feature_list.json",
  "docs/architecture.json", "docs/architecture.md",
  "docs/product_constitution.json", "docs/product_constitution.md",
  "docs/mission_control.md", "docs/intent_ledger.md",
  "docs/operating_model.md",
  "docs/conventions.md", "docs/specs.md", "docs/verification.md",
  "docs/acceptance_contract.json", "docs/acceptance.md",
  "verification/traceability.md", "verification/test_strategy.md",
  "verification/plans/TEMPLATE.md", "verification/reviews/TEMPLATE.md",
  "verification/evidence/TEMPLATE.md", "verification/final_gauntlet.md",
]
missing = [p for p in required if not Path(p).exists()]
if missing:
  raise SystemExit("Missing required files: " + ", ".join(missing))
json.loads(Path("feature_list.json").read_text())
json.loads(Path("docs/architecture.json").read_text())
contract = json.loads(Path("docs/acceptance_contract.json").read_text())
constitution = json.loads(Path("docs/product_constitution.json").read_text())
if not isinstance(constitution, dict) or not constitution.get("thesis"):
  raise SystemExit("docs/product_constitution.json must contain a concrete thesis")
if not list(Path("specs").glob("feature-*.md")):
  raise SystemExit("No feature specs found")
if not list(Path("scenarios").glob("scenario-*.md")):
  raise SystemExit("No scenarios found")
features = json.loads(Path("feature_list.json").read_text())
if not isinstance(features, list):
  raise SystemExit("feature_list.json must be a JSON array")
contract_ids = {f.get("id") for f in contract.get("features", []) if isinstance(f, dict)}
feature_ids = {f.get("id") for f in features if isinstance(f, dict)}
missing_contract = sorted(feature_ids - contract_ids)
if missing_contract:
  raise SystemExit("Acceptance contract missing feature ids: " + ", ".join(missing_contract))
for field in ("excellent_outcome", "unacceptable_outcomes", "non_negotiable_promises", "handwave_bans", "acceptance_laws", "evidence_laws"):
  value = constitution.get(field)
  if isinstance(value, list):
    if not value:
      raise SystemExit(f"Product constitution missing {field}")
  elif not str(value or "").strip():
    raise SystemExit(f"Product constitution missing {field}")

weak_tokens = ("tbd", "todo", "placeholder", "none yet", "not wired", "coming soon")
for contract_feature in contract.get("features", []):
  if not isinstance(contract_feature, dict):
    raise SystemExit("Acceptance contract features must be objects")
  fid = contract_feature.get("id")
  for field in ("entry_points", "acceptance_criteria", "verification"):
    values = contract_feature.get(field)
    if not isinstance(values, list) or not values:
      raise SystemExit(f"Acceptance contract feature '{fid}' is missing {field}")
    for value in values:
      lowered = str(value).lower()
      if any(token in lowered for token in weak_tokens):
        raise SystemExit(f"Acceptance contract feature '{fid}' has weak {field}: {value}")
traceability = Path("verification/traceability.md").read_text(errors="replace")
for feature in features:
  if not isinstance(feature, dict) or feature.get("status") != "done":
    continue
  fid = feature.get("id")
  trace_rows = [line for line in traceability.splitlines() if line.startswith(f"| {fid} |")]
  if not trace_rows:
    raise SystemExit(f"Feature '{fid}' is marked done but has no traceability rows.")
  bad_trace_rows = [line for line in trace_rows if any(token in line.lower() for token in weak_tokens) or "| pending |" in line.lower()]
  if bad_trace_rows:
    raise SystemExit(f"Feature '{fid}' traceability still has unfinished rows; update verification/traceability.md.")
  plan_path = Path("verification/plans") / f"{fid}.md"
  if not plan_path.exists():
    raise SystemExit(f"Feature '{fid}' is marked done but missing implementation plan: {plan_path}")
  plan = plan_path.read_text(errors="replace").lower()
  if any(token in plan for token in weak_tokens):
    raise SystemExit(f"Feature '{fid}' implementation plan contains weak placeholder language.")
  if "constitution" not in plan:
    raise SystemExit(f"Feature '{fid}' implementation plan must reference the product constitution.")
  review_types = ("contract-audit", "quality", "red-team", "product-owner")
  for review_type in review_types:
    review_path = Path("verification/reviews") / f"{fid}-{review_type}.md"
    if not review_path.exists():
      raise SystemExit(f"Feature '{fid}' is marked done but missing {review_type} review: {review_path}")
    review = review_path.read_text(errors="replace").lower()
    if "changes_requested" in review or "changes requested" in review:
      raise SystemExit(f"Feature '{fid}' {review_type} review requests changes.")
    if not re.search(r"(?mi)^\s*(verdict|status)\s*:\s*approved\s*$", review):
      raise SystemExit(f"Feature '{fid}' {review_type} review must include `Verdict: APPROVED`.")
    if review_type in {"contract-audit", "product-owner"} and "constitution" not in review:
      raise SystemExit(f"Feature '{fid}' {review_type} review must evaluate the product constitution.")
    if any(token in review for token in weak_tokens):
      raise SystemExit(f"Feature '{fid}' {review_type} review contains weak placeholder language.")
  evidence_path = Path("verification/evidence") / f"{fid}.md"
  if not evidence_path.exists():
    raise SystemExit(f"Feature '{fid}' is marked done but missing evidence file: {evidence_path}")
  evidence = evidence_path.read_text(errors="replace").lower()
  required_phrases = ("verification commands", "wiring audit", "acceptance criteria", "known gaps")
  missing_phrases = [p for p in required_phrases if p not in evidence]
  if missing_phrases:
    raise SystemExit(f"Feature '{fid}' evidence is missing sections: " + ", ".join(missing_phrases))
  if evidence_path.read_text(errors="replace").count("TBD") > 0:
    raise SystemExit(f"Feature '{fid}' evidence still contains TBD placeholders.")
  if "bash verify.sh" not in evidence:
    raise SystemExit(f"Feature '{fid}' evidence must include the actual `bash verify.sh` result.")
  if "constitution" not in evidence:
    raise SystemExit(f"Feature '{fid}' evidence must mention constitution coverage.")
  if "known gaps" in evidence and "none" not in evidence.split("known gaps", 1)[1][:200]:
    raise SystemExit(f"Feature '{fid}' evidence lists known gaps; it cannot be done.")
  if any(token in evidence for token in weak_tokens):
    raise SystemExit(f"Feature '{fid}' evidence contains weak placeholder language; replace it with real proof.")

if features and all(isinstance(feature, dict) and feature.get("status") == "done" for feature in features):
  final_gauntlet = Path("verification/final_gauntlet.md").read_text(errors="replace").lower()
  if "- [ ]" in final_gauntlet or any(token in final_gauntlet for token in weak_tokens):
    raise SystemExit("All features are marked done but verification/final_gauntlet.md is not complete.")

code_suffixes = {".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".html", ".css"}
ignored_parts = {".git", ".venv", "venv", "env", "node_modules", "dist", "build", "__pycache__", ".pytest_cache"}
scaffold_dirs = {"docs", "specs", "scenarios", "prompts", ".opencode"}
code_files = []
test_files = []
suspicious = []
suspicious_re = re.compile(r"TODO|FIXME|NotImplementedError|pass\s*(#.*)?$|stub|placeholder|coming soon|not wired|no-op", re.I)

for path in Path(".").rglob("*"):
  if not path.is_file():
    continue
  if any(part in ignored_parts for part in path.parts):
    continue
  if path.parts and path.parts[0] in scaffold_dirs:
    continue
  if path.name in {"AGENTS.md", "HANDOFF.md", "ROADMAP.md", "CHECKPOINTS.md", "ground-rules.md", "feature_list.json", "init.sh", "verify.sh"}:
    continue
  if path.suffix.lower() not in code_suffixes:
    continue
  code_files.append(path)
  lower_name = path.name.lower()
  if "test" in lower_name or (path.parts and path.parts[0] in {"tests", "test"}):
    test_files.append(path)
  try:
    for lineno, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
      if suspicious_re.search(line):
        suspicious.append(f"{path}:{lineno}: {line.strip()[:120]}")
  except Exception:
    pass

real_code = [p for p in code_files if not ("test" in p.name.lower() or (p.parts and p.parts[0] in {"tests", "test"}))]
if real_code and not test_files:
  raise SystemExit("Application code exists but no test files were found. Add executable tests before claiming verification.")
if suspicious:
  details = "\n".join(suspicious[:20])
  raise SystemExit("Suspicious stub/placeholder code found; finish wiring behavior before claiming verification:\n" + details)

print("Static scaffold and wiring-smell checks passed.")
PY

if find . -path './.git' -prune -o -path './node_modules' -prune -o -path './.venv' -prune -o -path './venv' -prune -o -name 'package.json' -print -quit | grep -q .; then
  if command -v npm >/dev/null 2>&1; then
    npm test
  else
    echo "package.json found but npm is unavailable."
    exit 1
  fi
fi

if find . -path './.git' -prune -o -path './.venv' -prune -o -path './venv' -prune -o -name '*.py' -print -quit | grep -q .; then
  python3 -m compileall -q .
  if find . -path './.git' -prune -o -path './.venv' -prune -o -path './venv' -prune -o \( -name 'test_*.py' -o -name '*_test.py' \) -print -quit | grep -q .; then
    python3 -m pytest
  fi
fi

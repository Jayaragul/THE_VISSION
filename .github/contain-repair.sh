#!/usr/bin/env bash
# Keep a repair attempt inside its lane.
#
# A repair may only touch edition data: generated/ and evals/. Anything else — the
# validator, the editorial rules, the source book, the workflow itself — is reverted
# before the gate runs again.
#
# This exists because a repair attempt edited tools/validate.mjs and left a syntax error in
# it, so the gate died on a SyntaxError instead of judging the edition. Rule 4 already says
# "fix the journalism, not the checker" and the repair prompt says the same, but a model
# under pressure to make a check pass will eventually reach for the check. Asking is not a
# control. This is.
#
# Worth noting what that run showed: the edition itself had reached zero errors. The loop
# converged on the journalism, and the only casualty was tooling the model was never
# supposed to touch. Nothing could have reached the repository — the publish job takes a
# clean checkout and copies only named files — but a broken validator in the workspace
# still cost the day its paper.
#
# Intended for CI, where the tree is clean apart from what this run produced. Run locally
# with uncommitted work and it will revert that work too, exactly as designed.

set -euo pipefail

ALLOWED='^(generated|evals)/'
reverted=0

# Tracked files modified or deleted outside the allowed paths.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  echo "  reverting: $f"
  git checkout -- "$f"
  reverted=$((reverted + 1))
done < <(git diff --name-only | grep -vE "$ALLOWED" || true)

# New files dropped outside the allowed paths.
#
# Three exemptions, all harness scratch rather than repository content: gate-report.txt is
# this loop's own brief, and .gemini/ plus gemini-artifacts/ are written by the Gemini CLI
# action itself. Deleting those was actively harmful — the first containment run removed
# .gemini/settings.json between attempts, pulling the CLI's own configuration out from under
# the next repair. Tracked files under .gemini/ (the shell allowlist) are still reverted by
# the loop above; this only spares the action's untracked working files.
SPARED='^(gate-report\.txt|\.gemini/|gemini-artifacts/)'
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    gate-report.txt|.gemini/*|gemini-artifacts/*) continue ;;
  esac
  echo "  removing stray: $f"
  rm -f "$f"
  reverted=$((reverted + 1))
done < <(git ls-files --others --exclude-standard | grep -vE "$ALLOWED" | grep -vE "$SPARED" || true)

if [ "$reverted" -gt 0 ]; then
  echo "::warning title=Repair reached outside edition data::Reverted ${reverted} file(s). A repair may only edit generated/ and evals/."
else
  echo "Repair stayed within generated/ and evals/."
fi

# Belt and braces: if a repair corrupted the tooling and the revert somehow missed it, fail
# here with a clear cause rather than letting the next gate die on a parse error.
node --check tools/validate.mjs
node --check tools/gate.mjs
echo "Validator and gate parse cleanly."

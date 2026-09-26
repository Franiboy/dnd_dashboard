#!/usr/bin/env bash
# Regression test for the trusted dispatch gate in ci-cd.yml. Run manually:
#   bash tests/ci/trustedGate.test.sh
#
# It exercises the "Require green pull request CI for this head" step from the real
# workflow. The step has two parts that can each be wrong independently: the jq
# expression that classifies an API answer, and the shell loop that acts on that
# classification. Both are tested, neither is transcribed.
set -uo pipefail

WORKFLOW="${1:-$(dirname "$0")/../../.github/workflows/ci-cd.yml}"
REAL=/tmp/opencode/p7-gate.sh
SHORT=/tmp/opencode/p7-gate-short.sh
FILTER=/tmp/opencode/p7-filter.txt

python3 - "$WORKFLOW" "$REAL" "$FILTER" <<'PY'
import sys, re, yaml
wf = yaml.safe_load(open(sys.argv[1]))
body = None
for job in wf['jobs'].values():
    for step in job.get('steps', []):
        if step.get('name') == 'Require green pull request CI for this head':
            body = step['run']
if body is None:
    raise SystemExit('step not found')
open(sys.argv[2], 'w').write(body)
m = re.search(r'--jq \\\n\s+(.*)', body)
if not m:
    raise SystemExit('jq filter not found')
raw = m.group(1).strip()
# The captured line is the shell argument: '<filter>')"  -- opening single quote,
# the filter, then closing single quote, paren and double quote.
quote, dquote = chr(39), chr(34)
if raw.startswith(quote):
    raw = raw[1:]
if raw.endswith(quote + ")" + dquote):
    raw = raw[:-3]
open(sys.argv[3], 'w').write(raw)
print('extrahiert: step und jq-filter')
PY
sed 's/+ 900 )/+ 1 )/' "$REAL" > "$SHORT"

fails=0

echo '=== Teil 1: jq-Klassifikation gegen echte API-Antworten ==='
filter="$(cat "$FILTER")"
classify() {
  printf '%s' "$2" | jq -r "$filter"
}
check_state() {
  local name="$1" fixture="$2" expect="$3" got
  got="$(classify "$name" "$fixture")"
  if [ "$got" = "$expect" ]; then
    printf '  %-50s -> %-8s OK\n' "$name" "$got"
  else
    printf '  %-50s -> %-8s ERWARTET %s  FEHLER\n' "$name" "$got" "$expect"
    fails=$((fails + 1))
  fi
}

RUNS_HEAD='"total_count":1,"workflow_runs":[{"id":1,"name":"CI","head_sha":"abc","status":"completed","conclusion":"success"}]'
RUNS_INPROGRESS='"total_count":1,"workflow_runs":[{"id":2,"name":"CI","head_sha":"abc","status":"in_progress","conclusion":null}]'
RUNS_FAILURE='"total_count":1,"workflow_runs":[{"id":3,"name":"CI","head_sha":"abc","status":"completed","conclusion":"failure"}]'
RUNS_CANCELLED='"total_count":1,"workflow_runs":[{"id":4,"name":"CI","head_sha":"abc","status":"completed","conclusion":"cancelled"}]'
RUNS_TIMEDOUT='"total_count":1,"workflow_runs":[{"id":5,"name":"CI","head_sha":"abc","status":"completed","conclusion":"timed_out"}]'
RUNS_OTHER_WORKFLOW='"total_count":1,"workflow_runs":[{"id":6,"name":"CodeQL","head_sha":"abc","status":"completed","conclusion":"success"}]'
RUNS_NEWEST_WINS='"total_count":2,"workflow_runs":[{"id":7,"name":"CI","head_sha":"abc","status":"completed","conclusion":"failure"},{"id":8,"name":"CI","head_sha":"abc","status":"completed","conclusion":"success"}]'
RUNS_EMPTY='{"total_count":0,"workflow_runs":[]}'

check_state 'kein Lauf' "$RUNS_EMPTY" 'missing'
check_state 'Lauf laeuft noch' "{${RUNS_INPROGRESS}}" 'pending'
check_state 'gruen' "{${RUNS_HEAD}}" 'success'
check_state 'fehlgeschlagen' "{${RUNS_FAILURE}}" 'failed'
check_state 'abgebrochen' "{${RUNS_CANCELLED}}" 'failed'
check_state 'Timeout' "{${RUNS_TIMEDOUT}}" 'failed'
check_state 'anderer Workflow ignoriert' "{${RUNS_OTHER_WORKFLOW}}" 'missing'
check_state 'juengster Lauf zaehlt' "{${RUNS_NEWEST_WINS}}" 'success'

echo
echo '=== Teil 2: Shell-Schleife gegen die Zustände ==='
STUB=/tmp/opencode/p7-stub
rm -rf "$STUB"; mkdir -p "$STUB"
cat > "$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
if [ "${STUB_GH_FAILS:-}" = "1" ]; then
  echo '{"message":"Resource not accessible","status":"403"}'
  exit 1
fi
n=$(cat /tmp/opencode/p7.counter 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > /tmp/opencode/p7.counter
total=$(wc -l < /tmp/opencode/p7.queue)
[ "$n" -le "$total" ] || n=$total
sed -n "${n}p" /tmp/opencode/p7.queue
STUBEOF
chmod +x "$STUB/gh"

SHA=2276ae063b39fde746660aa30bc43217d9ed7f0f
invoke() {
  local lib="$1" queue="$2" gh_fail="${3:-}"
  printf '%s' "$queue" > /tmp/opencode/p7.queue
  rm -f /tmp/opencode/p7.counter
  (
    export PATH="$STUB:$PATH"
    export GITHUB_REPOSITORY=Franiboy/dnd_dashboard HEAD_SHA="$SHA"
    [ -n "$gh_fail" ] && export STUB_GH_FAILS=1
    # shellcheck disable=SC1090
    . "$lib"
  ) 2>&1
}
check() {
  local name="$1" expect_rc="$2" expect_grep="$3" out="$4" rc="$5"
  local ok=1
  [ "$rc" = "$expect_rc" ] || ok=0
  [ -n "$expect_grep" ] && { printf '%s' "$out" | grep -q "$expect_grep" || ok=0; }
  if [ "$ok" = 1 ]; then
    printf '  %-50s rc=%s  OK\n' "$name" "$rc"
    printf '%s\n' "$out" | grep -E '::error|pull request CI is green' | sed 's/^/      /'
  else
    printf '  %-50s rc=%s  ERWARTET %s / %s  FEHLER\n' "$name" "$rc" "$expect_rc" "${expect_grep:-}"
    printf '%s\n' "$out" | sed 's/^/      /'
    return 1
  fi
  return 0
}

out=$(invoke "$REAL" 'success
'); rc=$?
check 'Zustand success' 0 'pull request CI is green' "$out" "$rc" || fails=$((fails + 1))

out=$(invoke "$REAL" 'pending
success
'); rc=$?
check 'pending, dann success' 0 'pull request CI is green' "$out" "$rc" || fails=$((fails + 1))

out=$(invoke "$REAL" 'failed
'); rc=$?
check 'Zustand failed' 1 'did not succeed' "$out" "$rc" || fails=$((fails + 1))

out=$(invoke "$SHORT" 'missing
'); rc=$?
check 'Zustand missing, Deadline laeuft ab' 1 'within 900s' "$out" "$rc" || fails=$((fails + 1))

out=$(invoke "$REAL" 'success
' 1); rc=$?
if [ "$rc" != 0 ]; then
  printf '  %-50s rc=%s  OK (fail closed)\n' 'Antwort nicht lesbar' "$rc"
else
  printf '  %-50s rc=0  FEHLER: Gate haette bei Lesefehler bestanden\n' 'Antwort nicht lesbar'
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then echo 'alle Faelle wie erwartet'; else echo "$fails Faelle falsch"; fi
exit "$fails"

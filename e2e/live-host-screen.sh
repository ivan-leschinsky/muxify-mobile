#!/bin/bash
#
# Runs e2e/live-host-screen.ad against a sandboxed Muxify on this Mac, the dev
# Host (see e2e/sandbox.sh): a Topic made with `muxify topic new` on the Host
# while the Host Screen shows it appears there, with no visit to another
# screen, because the Host Server pushes the new Listing.
#
# The Topic is made once the app's Host Server runs: a `muxify server` under
# the sandbox's sshd, which the Host Screen starts when it opens the Connection.
#
#   bash e2e/live-host-screen.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

case "$(tmux display-message -p '#{socket_path}')" in
  "$(cd "$MUXIFY_E2E_ROOT" && pwd -P)"/*) ;;
  *) echo "tmux is not the sandbox's server"; exit 1 ;;
esac

bash "$(dirname "$0")/topics-tab.sh" || exit 1
muxify topic new "e2e Already There" --json >/dev/null || exit 1

# Whether a `muxify … server` runs under the sandbox's sshd.
host_server_runs() {
  ps -axww -o pid=,ppid=,command= | python3 -c '
import re, sys
sshd = int(open(sys.argv[1]).read())
procs = {}
for line in sys.stdin:
    pid, ppid, command = line.strip().split(None, 2)
    procs[int(pid)] = (int(ppid), command)
def under_sshd(pid):
    while pid in procs and pid > 1:
        if pid == sshd:
            return True
        pid = procs[pid][0]
    return False
sys.exit(not any(re.search(r"muxify\S* server$", command) and under_sshd(pid) for pid, (_, command) in procs.items()))
' "$MUXIFY_E2E_ROOT/sshd.pid"
}

(
  for _ in $(seq 120); do
    host_server_runs && break
    sleep 0.5
  done
  host_server_runs || { echo "no Host Server started under the sandbox's sshd"; exit 1; }
  # Its first push has reached the screen, which the .ad waits for.
  sleep 3
  muxify topic new "e2e Made on the Host" --json >/dev/null && echo "made e2e Made on the Host on the Host"
) &
maker=$!

agent-device test ./e2e/live-host-screen.ad
status=$?
wait "$maker" || status=1
exit "$status"

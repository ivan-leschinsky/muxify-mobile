#!/bin/bash
#
# Checks that a New Topic whose answer is lost makes one Topic and shows no
# error (ADR 0021), against a sandboxed Muxify on this Mac, the dev Host (see
# e2e/sandbox.sh). It checks two times: e2e/request-resend.test.ts drives the
# app's Connections and Host Server link over real SSH, and
# e2e/request-resend.ad drives the app in the Simulator. MUXIFY_E2E_NO_APP=1
# leaves out the second, for a Simulator whose app is not built from this
# checkout.
#
# The Host's `muxify server` here runs behind a proxy. On the first send of
# each Request id, the proxy lets the Host Server apply the write and then ends
# the channel in place of its `end`, so the answer of that send is lost. The
# link starts the Host Server again on the same Connection, and the phone sends
# the same Request to it. A second send of the id, and every request with no
# id, such as a read, goes through. If each send were lost, the second would
# get no answer either, and the app would be right to say that the Topic may
# be on the Host.
#
#   bash e2e/request-resend.sh

[ -n "${MUXIFY_E2E_ROOT:-}" ] || exec bash "$(dirname "$0")/sandbox.sh" bash "$0" "$@"

set -uo pipefail

ROOT=$MUXIFY_E2E_ROOT
TITLE="e2e Request Topic"
CALLS="$ROOT/request-calls"

mkdir -p "$ROOT/sent"
: >"$CALLS"
# The sandbox's stub stays the way to the real CLI for every other command.
mv "$ROOT/bin/muxify" "$ROOT/bin/muxify-sandbox"
cat >"$ROOT/request-proxy.py" <<'PY'
import json, os, subprocess, sys, threading

root, real = sys.argv[1], sys.argv[2]
server = subprocess.Popen([real, "server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr)
# Frame ids of first sends, whose `end` the phone must not get.
lost = set()
lock = threading.Lock()

def from_phone():
    for line in sys.stdin.buffer:
        try:
            frame = json.loads(line)
        except ValueError:
            frame = None
        environment = (frame or {}).get("request", {}).get("environment") if isinstance(frame, dict) else None
        request = environment.get("request") if isinstance(environment, dict) else None
        if request:
            command = next(iter(environment.get("command", {})), "?")
            with open(os.path.join(root, "request-calls"), "a") as calls:
                calls.write(f"{request} {command}\n")
            marker = os.path.join(root, "sent", request)
            if not os.path.exists(marker):
                open(marker, "w").close()
                with lock:
                    lost.add(frame["id"])
        server.stdin.write(line)
        server.stdin.flush()
    server.stdin.close()

threading.Thread(target=from_phone, daemon=True).start()
for line in server.stdout:
    try:
        frame = json.loads(line)
    except ValueError:
        frame = None
    with lock:
        drop = isinstance(frame, dict) and frame.get("kind") == "end" and frame.get("id") in lost
    if drop:
        # The Host applied the write. Its answer is lost with the channel.
        server.kill()
        sys.stderr.write("request-proxy: lost the answer of a first send\n")
        sys.stderr.flush()
        os._exit(1)
    sys.stdout.buffer.write(line)
    sys.stdout.buffer.flush()
sys.exit(server.wait())
PY
cat >"$ROOT/bin/muxify" <<EOF
#!/bin/sh
if [ "\$1" = server ] && [ ! -f "$ROOT/no-host-server" ]; then
  exec python3 "$ROOT/request-proxy.py" "$ROOT" "$ROOT/bin/muxify-sandbox"
fi
exec "$ROOT/bin/muxify-sandbox" "\$@"
EOF
chmod +x "$ROOT/bin/muxify"

bash "$(dirname "$0")/topics-tab.sh" || exit 1

# The sandbox's sshd takes the keys of your account, which the app has and
# this script does not. So the jest check gets an sshd of its own, with the
# sandbox's environment and a key that lives in the sandbox.
ssh-keygen -q -t ed25519 -N '' -f "$ROOT/client_key" || exit 1
# Added, not copied over: the file may hold MUXIFY_E2E_AUTHORIZED_KEY, which the app logs in with.
cat "$ROOT/client_key.pub" >>"$ROOT/authorized_keys"
chmod 600 "$ROOT/authorized_keys"
SSH_PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
sed -e "s/^Port .*/Port $SSH_PORT/" -e "s|^PidFile .*|PidFile $ROOT/sshd-jest.pid|" "$ROOT/sshd_config" >"$ROOT/sshd_jest_config"
printf 'AuthorizedKeysFile %s\nStrictModes no\n' "$ROOT/authorized_keys" >>"$ROOT/sshd_jest_config"
/usr/sbin/sshd -f "$ROOT/sshd_jest_config" -E "$ROOT/sshd-jest.log" || { cat "$ROOT/sshd-jest.log"; exit 1; }
trap '[ -f "$ROOT/sshd-jest.pid" ] && kill "$(cat "$ROOT/sshd-jest.pid")" 2>/dev/null' EXIT
for _ in $(seq 50); do
  nc -z 127.0.0.1 "$SSH_PORT" 2>/dev/null && break
  sleep 0.1
done

MUXIFY_E2E_SSH_PORT=$SSH_PORT pnpm exec jest --testPathIgnorePatterns /node_modules/ --runTestsByPath e2e/request-resend.test.ts || exit 1

if [ -n "${MUXIFY_E2E_NO_APP:-}" ]; then
  echo "left out the Simulator check"
  exit 0
fi

device=()
[ -z "${MUXIFY_E2E_DEVICE:-}" ] || device=(--udid "$MUXIFY_E2E_DEVICE")
: >"$CALLS"
agent-device test ./e2e/request-resend.ad "${device[@]}" || exit 1

muxify environment show --json | python3 -c '
import json, sys
title, calls = sys.argv[1], [line.split() for line in open(sys.argv[2])]
snapshot = json.load(sys.stdin)
cards = snapshot["pinned"] + [card for part in ("places", "guests", "bench") for card in snapshot["unpinned"][part]]
made = [card["topic"] for card in cards if card["kind"] == "topic" and card["topic"]["label"].startswith(title)]
labels = [topic["label"] for topic in made if not topic["label"].endswith("over SSH")]
assert labels == [title], f"the Host has {labels}"
topic = next(topic for topic in made if topic["label"] == title)
sends = [call for call in calls if call[1] == "create"]
assert len(sends) == 2, f"create went out {len(sends)} times"
assert sends[0][0] == sends[1][0] == topic["id"], "the two sends and the Topic do not share one id"
print("the Host has one Topic, from two sends of one Request")
' "$TITLE" "$CALLS"

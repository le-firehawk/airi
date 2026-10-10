#!/usr/bin/env bash
# Godot can exit successfully after a script parse error. Check both channels.
set -euo pipefail

log_file="$1"
shift
mkdir -p "$(dirname "$log_file")"
"$@" 2>&1 | tee "$log_file"

python3 - "$log_file" <<'PY'
import pathlib
import re
import sys

output = pathlib.Path(sys.argv[1]).read_text(errors="replace")
output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
if re.search(r"^\s*(?:SCRIPT ERROR|ERROR|FATAL):", output, re.MULTILINE):
    sys.exit("Godot reported an engine or script error; see the captured log.")
PY

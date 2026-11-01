#!/bin/sh
# Experiment behind docs/phase9/linux-zsh-probe-diagnosis.md.
#
# Claim under test: compinit answers its "insecure directories" question with
# `read -q`, which consumes exactly ONE character. On a Debian runner that one
# character is taken off the front of the setup command the probe types next.
# The claim is only interesting if losing one character reproduces the exact
# pass/fail partition the Linux runner recorded -- three cases failing, two of
# them with a different symptom from the third, and four cases unaffected.
#
# This script takes the real setup strings generated from the product source
# (see the companion .mjs), feeds each to zsh twice -- intact, then with its
# first character removed -- and reports whether the ready marker still appears.
#
# It needs no PTY and no Linux: it isolates the consequence of the swallowed
# byte, not the swallowing itself. Confirming that Debian's compinit is what
# eats the byte still requires the runner (see the document's取证 section).
#
# Usage: sh scripts/experiments/zsh-swallowed-byte-experiment.sh <workdir>
set -eu

WORK=${1:?usage: zsh-swallowed-byte-experiment.sh <workdir>}
mkdir -p "$WORK/bin"

# The sandbox this was authored in denies the real mktemp; the shim keeps the
# three mktemp-based cases runnable. It is scoped to $WORK and creates nothing
# outside it.
printf '#!/bin/sh\nd="$WORK/mk.$$"\nmkdir -p "$d"\nprintf "%%s\\n" "$d"\n' > "$WORK/bin/mktemp"
chmod +x "$WORK/bin/mktemp"

printf '%-18s | %-9s | %-9s | %s\n' CASE INTACT DROP-1CH VERDICT
printf -- '-------------------+-----------+-----------+--------------------------------\n'

for case_file in "$WORK"/cases/*.cmd; do
  case_name=$(basename "$case_file" .cmd)
  cmd=$(cat "$case_file")
  results=''
  for variant in intact drop; do
    run=$cmd
    if [ "$variant" = drop ]; then
      # Drop exactly one leading character: what `read -q` consumes.
      run=${cmd#?}
    fi
    out=$(PATH="$WORK/bin:$PATH" WORK="$WORK" HOME="$WORK" \
      zsh -f -c "cd '$WORK'; { $run ; } </dev/null 2>&1 | head -40" 2>&1 || true)
    if printf '%s' "$out" | grep -q 'READY__'; then
      results="$results ready"
    else
      results="$results NO-READY"
    fi
  done
  # shellcheck disable=SC2086
  set -- $results
  verdict='unaffected by the lost byte'
  [ "$1" != "$2" ] && verdict='DIVERGES (ready marker lost)'
  printf '%-18s | %-9s | %-9s | %s\n' "$case_name" "$1" "$2" "$verdict"
done

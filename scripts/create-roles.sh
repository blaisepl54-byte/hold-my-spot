#!/usr/bin/env bash
# scripts/create-roles.sh
#
# KING B RUNS THIS. The implementer does not, and must not.
#
# Why this script exists. R-C says King B creates the three roles and the
# implementer never holds a superuser credential, because B1 proves each role
# is bounded and a superuser in the same session makes that proof meaningless.
# CC generated the three passwords and wrote .env; it cannot create the roles.
# This script is the seam: it reads the passwords CC already wrote, and runs
# db/roles.sql under YOUR superuser connection.
#
# You never see, type, or paste a password. It never reaches chat.
#
# USAGE
#   bash scripts/create-roles.sh
#
# That is the whole command. No arguments. psql will prompt you for the
# postgres password TWICE, once per database it connects to. Both prompts want
# the same password. Two prompts rather than one is deliberate; see below.
#
# Optionally pass a different superuser name:
#   bash scripts/create-roles.sh myadminuser
#
# DO NOT put a password on the command line. An earlier attempt used
#   ...://postgres:<yourpw>@localhost...
# and the shell read "<" as a redirection and failed with
#   "yourpw: No such file or directory".
# Angle brackets are placeholder notation. Beyond that, a password containing
# @ : / or # corrupts a connection URL unless percent-encoded, and anything on
# the command line lands in shell history and the process list. Prompting
# removes all three problems at once.
#
# SECURITY NOTES, stated rather than assumed:
#   - Your superuser password is never seen by this script. psql prompts you
#     for it directly, twice, once per database connection. It is never in
#     argv, never in shell history, and never in an environment variable.
#     PGPASSWORD is NOT used. An earlier version did use it; see the note above
#     the SUPERUSER assignment for why that was removed.
#   - The three ROLE passwords are passed to psql through a temporary file
#     under umask 077, NOT through argv, removed by an EXIT trap on success,
#     failure, and interrupt alike.
#   - Nothing here echoes a credential. Presence is tested by exit status.

set -euo pipefail
umask 077

# REFUSE TO RUN UNDER WSL.
#
# On Windows, `bash` typed at a PowerShell prompt resolves to
# C:\Windows\system32\bash.exe, which is WSL, NOT Git Bash. That was the actual
# cause of a long failure chain on 2026-08-15: Windows paths are /mnt/c there
# rather than /c, the Windows psql is not on its PATH, and WSL2 runs its own
# network namespace so `localhost` does not reach a PostgreSQL running on
# Windows. Every symptom seen that day follows from this one fact.
#
# This refuses rather than adapting, because making the paths work under WSL
# would produce a script that finds psql and then fails to connect, which is a
# worse failure: it would look like a credential problem again.
if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; then
  echo "ERROR: this is running under WSL. It must run under GIT BASH." >&2
  echo "" >&2
  echo "  From PowerShell, 'bash' means WSL. Use Git Bash explicitly:" >&2
  echo "" >&2
  echo '    & "C:\Program Files\Git\bin\bash.exe" scripts/create-roles.sh' >&2
  echo "" >&2
  echo "  WSL cannot reach a PostgreSQL running on Windows via localhost," >&2
  echo "  so this would fail at connection even with psql available." >&2
  echo "  Nothing was changed." >&2
  exit 2
fi

cd "$(dirname "$0")/.."

DBNAME="holdmyspot"
PGHOST_="${PGHOST:-localhost}"
PGPORT_="${PGPORT:-5432}"

# THIS SCRIPT DOES NOT READ YOUR PASSWORD. psql prompts you directly.
#
# It used to read the password in bash and export PGPASSWORD. That failed
# repeatedly on 2026-08-15 with "wrong password" while the identical password
# worked in `psql -U postgres` typed by hand. Two hypotheses were tried and
# both were wrong. The third response was to stop diagnosing the mechanism and
# DELETE it: the only difference between the working case and the failing case
# was who collected the password, so psql now collects it, exactly as it does
# in the command that was proven to work.
#
# Consequence: psql prompts twice, once per database it must connect to.
# Two prompts is the price of not owning a password-handling bug.
#
# The three ROLE passwords are unaffected. They are never typed; they come from
# .env through a temp file, which was never the failing part.

SUPERUSER="${1:-postgres}"

# Resolve psql explicitly.
#
# A non-interactive `bash script.sh` launched from PowerShell does NOT source
# the interactive profile, so PostgreSQL's bin directory can be absent from
# PATH even though `psql` works fine in an interactive shell. That happened on
# 2026-08-15 and produced `psql: command not found` INSIDE this script.
#
# Worse, the previous version ran its probe with `2>&1` into /dev/null, so that
# message was swallowed and the script asserted "Wrong password" instead. The
# password was correct throughout. A probe that hides stderr and then names a
# cause is stating a conclusion it has not established; that is why nothing
# below discards stderr.
PSQL=""
if command -v psql >/dev/null 2>&1; then
  PSQL="psql"
else
  for candidate in \
    "/c/Program Files/PostgreSQL"/*/bin/psql \
    "/c/Program Files (x86)/PostgreSQL"/*/bin/psql
  do
    if [ -x "$candidate" ]; then PSQL="$candidate"; break; fi
  done
fi

if [ -z "$PSQL" ]; then
  echo "ERROR: psql not found." >&2
  echo "       Searched PATH, and:" >&2
  echo "         C:\\Program Files\\PostgreSQL\\*\\bin\\psql" >&2
  echo "         C:\\Program Files (x86)\\PostgreSQL\\*\\bin\\psql" >&2
  echo "       Nothing was changed." >&2
  exit 2
fi
echo "==> using psql at: $PSQL"
"$PSQL" --version

if [ ! -f .env ]; then
  echo "ERROR: .env not found. It carries the three role passwords." >&2
  exit 2
fi

if [ ! -f db/roles.sql ]; then
  echo "ERROR: db/roles.sql not found." >&2
  exit 2
fi

# Extract each password from its URL. Never echoed.
extract() {
  sed -nE "s#^$1=postgresql://[^:]+:([^@]+)@.*#\1#p" .env
}

DDL_PW="$(extract HMS_DDL_URL)"
RW_PW="$(extract HMS_RW_URL)"
RO_PW="$(extract HMS_RO_URL)"

for pair in "HMS_DDL_URL:$DDL_PW" "HMS_RW_URL:$RW_PW" "HMS_RO_URL:$RO_PW"; do
  if [ -z "${pair#*:}" ]; then
    echo "ERROR: could not read a password for ${pair%%:*} from .env." >&2
    exit 2
  fi
done

VARFILE="$(mktemp)"
trap 'rm -f "$VARFILE"' EXIT INT TERM

# Every line goes through printf '%s\n', which does NOT interpret backslash
# escapes in its arguments. The earlier form, printf "\\echo ...", let bash's
# printf read \e as the ESCAPE character: it swallowed "\ec" and emitted a bare
# "ho '--- roles now present ---'". \set and \i survived only because neither
# \s nor \i is a printf escape, which is exactly the kind of near-miss that
# makes the format-string form unsafe here. Do not reintroduce it.
printf '%s\n' \
  "\\set HMS_DDL_PASSWORD '$DDL_PW'" \
  "\\set HMS_RW_PASSWORD '$RW_PW'" \
  "\\set HMS_RO_PASSWORD '$RO_PW'" \
  "\\set DBNAME $DBNAME" \
  "\\i db/roles.sql" \
  > "$VARFILE"

unset DDL_PW RW_PW RO_PW

# Step 1. The database must exist before roles.sql can GRANT CONNECT on it.
# CREATE DATABASE cannot run inside a transaction block, so it is its own call.
# Invocation deliberately matches the form PROVEN to work by hand:
#   psql -U postgres -c "SELECT current_user"
# No -h and no -p, so nothing here can differ from that proven command. Set
# PGHOST or PGPORT in your environment if you need a non-default target.

# Step 1, ONE connection to the 'postgres' database.
# \gexec runs the CREATE DATABASE only if the SELECT produced it, so existence
# check and creation happen in a single call and therefore a single prompt.
# CREATE DATABASE cannot run inside a transaction block; \gexec does not open
# one, which is why this works and a DO block would not.
echo "==> [1 of 2] connecting as '$SUPERUSER' to ensure database '$DBNAME' exists"
echo "    psql will now ask for the $SUPERUSER password"
if ! "$PSQL" -U "$SUPERUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE DATABASE $DBNAME'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DBNAME')\gexec
SQL
then
  echo "ERROR: step 1 failed. psql's own error is printed above this line;" >&2
  echo "       read it rather than assuming a cause. Nothing was changed." >&2
  exit 1
fi
echo "    database ready"

# Step 2, ONE connection to the target database: roles, grants, verification.
# roles.sql is idempotent: each CREATE ROLE is guarded by a pg_roles check.
# The verification SELECT is appended to the same file so it costs no extra
# connection and therefore no extra prompt.
printf '%s\n' \
  "\\echo '--- roles now present ---'" \
  "SELECT rolname FROM pg_roles WHERE rolname IN ('hms_ddl','hms_rw','hms_ro') ORDER BY rolname;" \
  >> "$VARFILE"

echo "==> [2 of 2] applying db/roles.sql to '$DBNAME'"
echo "    psql will ask for the $SUPERUSER password once more"
"$PSQL" -U "$SUPERUSER" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$VARFILE"

echo
echo "Next: tell CC that .env exists and B1 is unblocked."

#!/usr/bin/env bash
# Fails when the Blocks moduleInput contract no longer matches the version this
# SDK's types were last reviewed against. Keeps this SDK from drifting the way
# the iOS and Android SDKs drifted from each other.
#
# This repo is public, so it stores a SHA-256 of the contract rather than a copy
# of it -- the contract is private Blocks source. A hash still detects any
# change; to see *what* changed, read the file's history in insurely-blocks,
# which is the better place to look anyway.
set -euo pipefail

BLOCKS_PATH="${BLOCKS_PATH:-../insurely-blocks}"
SOURCE="$BLOCKS_PATH/apps/blocks/src/types/configurations/moduleInput.schema.ts"
BASELINE="src/types/__contract__/moduleInput.schema.sha256"

if [ ! -f "$SOURCE" ]; then
  echo "skip: insurely-blocks not checked out at $BLOCKS_PATH"
  exit 0
fi

expected="$(cat "$BASELINE")"
actual="$(shasum -a 256 "$SOURCE" | awk '{print $1}')"

if [ "$expected" != "$actual" ]; then
  echo "The Blocks moduleInput contract has changed."
  echo "  reviewed: $expected"
  echo "  current:  $actual"
  echo ""
  echo "Review the change in insurely-blocks:"
  echo "  git -C $BLOCKS_PATH log -p -- apps/blocks/src/types/configurations/moduleInput.schema.ts"
  echo ""
  echo "Update src/types/config.ts to match, then refresh the baseline:"
  echo "  shasum -a 256 $SOURCE | awk '{print \$1}' > $BASELINE"
  exit 1
fi

echo "contract in sync"

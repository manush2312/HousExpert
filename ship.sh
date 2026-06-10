#!/usr/bin/env bash
set -e

# Usage: ./ship.sh "commit message"
# If no message is provided, you'll be prompted.

BRANCH=$(git rev-parse --abbrev-ref HEAD)
MAIN="main"

if [ "$BRANCH" = "$MAIN" ]; then
  echo "Error: you're on $MAIN. Switch to a feature branch first."
  exit 1
fi

# Commit message
if [ -n "$1" ]; then
  MSG="$1"
else
  printf "Commit message: "
  read -r MSG
fi

if [ -z "$MSG" ]; then
  echo "Error: commit message cannot be empty."
  exit 1
fi

echo ""
echo "==> Staging all changes..."
git add -A

echo "==> Committing: \"$MSG\""
git commit -m "$MSG"

echo "==> Pushing branch '$BRANCH'..."
git push -u origin "$BRANCH"

echo "==> Creating PR to $MAIN..."
PR_URL=$(gh pr create \
  --base "$MAIN" \
  --head "$BRANCH" \
  --title "$MSG" \
  --body "" \
  --fill 2>/dev/null || gh pr view --json url -q .url)

echo "    PR: $PR_URL"

echo "==> Merging PR (squash)..."
gh pr merge "$BRANCH" --squash --delete-branch

echo ""
echo "Done. Branch '$BRANCH' merged into $MAIN and deleted."

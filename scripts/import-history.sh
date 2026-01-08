#!/bin/bash

# Configuration
ARCHIVE_DIR="${HOME}/Downloads/termoenergetica"
BRANCH_NAME="history-rebuild"
MIN_FILE_SIZE=100  # Skip files smaller than this (empty archives)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Historical Data Import Script ===${NC}"
echo "Archive directory: $ARCHIVE_DIR"
echo ""

# Check if archive directory exists
if [ ! -d "$ARCHIVE_DIR" ]; then
    echo -e "${RED}Error: Archive directory not found: $ARCHIVE_DIR${NC}"
    exit 1
fi

# Build sorted list of valid files (sort by timestamp extracted from filename)
echo "Scanning archive files..."
tmpfile=$(mktemp)
find "$ARCHIVE_DIR" -name "archive.*.html.gz" -size +${MIN_FILE_SIZE}c -exec basename {} \; | sort > "$tmpfile"
total_files=$(wc -l < "$tmpfile" | tr -d ' ')

echo "Found $total_files valid archive files (>${MIN_FILE_SIZE} bytes)"
echo ""

if [ "$total_files" -eq 0 ]; then
    echo -e "${RED}Error: No valid archive files found${NC}"
    rm "$tmpfile"
    exit 1
fi

# Confirm before proceeding
read -p "This will create up to $total_files commits. Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    rm "$tmpfile"
    exit 1
fi

# Create orphan branch
echo -e "${YELLOW}Creating orphan branch: $BRANCH_NAME${NC}"
git checkout --orphan "$BRANCH_NAME"
git rm -rf . 2>/dev/null || true
git clean -fd 2>/dev/null || true

# Create directory structure
mkdir -p .github/workflows
mkdir -p data

# Copy setup files from original main
git show main:.github/workflows/flat.yml > .github/workflows/flat.yml
git show main:README.md > README.md
touch data/.gitkeep

# Get first timestamp for initial commit date
first_filename=$(head -1 "$tmpfile")
first_timestamp=$(echo "$first_filename" | grep -oE '[0-9]+')
first_date=$(date -r "$first_timestamp" "+%Y-%m-%d %H:%M:%S")

echo -e "${GREEN}Creating initial setup commit (dated: $first_date)${NC}"
git add .
GIT_AUTHOR_DATE="@$first_timestamp" GIT_COMMITTER_DATE="@$first_timestamp" \
    git commit -m "Initial setup: Flat Data workflow for termoficare status"

# Process archive files
echo ""
echo -e "${GREEN}Processing archive files...${NC}"
count=0
skipped=0
unchanged=0
start_time=$(date +%s)

while IFS= read -r filename; do
    filepath="${ARCHIVE_DIR}/${filename}"

    # Extract timestamp from filename
    timestamp=$(echo "$filename" | grep -oE '[0-9]+')

    # Format date for commit message
    commit_date=$(date -r "$timestamp" "+%Y-%m-%d %H:%M:%S")

    # Decompress to data/termoficare.html
    if gunzip -c "$filepath" > data/termoficare.html 2>/dev/null; then
        # Check if file has content
        if [ -s data/termoficare.html ]; then
            # Stage the file
            git add data/termoficare.html

            # Only commit if there are staged changes
            if ! git diff --cached --quiet; then
                GIT_AUTHOR_NAME="Archive Bot" GIT_AUTHOR_EMAIL="archive@localhost" \
                GIT_COMMITTER_NAME="Archive Bot" GIT_COMMITTER_EMAIL="archive@localhost" \
                GIT_AUTHOR_DATE="@$timestamp" GIT_COMMITTER_DATE="@$timestamp" \
                    git commit --no-verify -m "Archive: $commit_date" --quiet
                ((count++))
            else
                ((unchanged++))
            fi
        else
            ((skipped++))
        fi
    else
        ((skipped++))
    fi

    # Progress update every 1000 processed files
    processed=$((count + skipped + unchanged))
    if [ $((processed % 1000)) -eq 0 ] && [ $processed -gt 0 ]; then
        elapsed=$(($(date +%s) - start_time))
        if [ $elapsed -gt 0 ]; then
            rate=$((processed / elapsed))
            remaining=$(( (total_files - processed) / (rate + 1) ))
            remaining_min=$((remaining / 60))
            echo -e "${YELLOW}Progress: $processed / $total_files processed | $count commits | ~${remaining_min}m remaining${NC}"
        fi
    fi
done < "$tmpfile"

rm "$tmpfile"

# Final summary
elapsed=$(($(date +%s) - start_time))
elapsed_min=$((elapsed / 60))
echo ""
echo -e "${GREEN}=== Import Complete ===${NC}"
echo "Commits created: $count"
echo "Unchanged (skipped): $unchanged"
echo "Failed/empty: $skipped"
echo "Time elapsed: ${elapsed_min} minutes"
echo ""
echo "Next steps:"
echo "  1. Review: git log --oneline $BRANCH_NAME | head -20"
echo "  2. Check dates: git log --format='%ai %s' $BRANCH_NAME | head -10"
echo "  3. Replace main: git checkout main && git reset --hard $BRANCH_NAME"
echo "  4. Force push: git push --force origin main"

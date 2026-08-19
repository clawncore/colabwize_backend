#!/bin/bash

# setup-pandoc.sh
# Ensures Pandoc is available for document export on Render

set -e

# Target directory for the binary
TARGET_DIR="bin/bin"
PANDOC_BIN="$TARGET_DIR/pandoc"

# Version to download
PANDOC_VERSION="3.1.11"

# Check if Pandoc already exists
if [ -f "$PANDOC_BIN" ]; then
    echo "✅ Pandoc already exists at $PANDOC_BIN"
    exit 0
fi

# Check if Pandoc is already in the PATH
if command -v pandoc >/dev/null 2>&1; then
    echo "✅ Pandoc is already in the system PATH"
    exit 0
fi

echo "🚀 Pandoc not found. Downloading standalone version $PANDOC_VERSION..."

# Create the target directory
mkdir -p "$TARGET_DIR"

# Download the tarball
TEMP_DIR=$(mktemp -d)
TARBALL="pandoc-$PANDOC_VERSION-linux-amd64.tar.gz"
URL="https://github.com/jgm/pandoc/releases/download/$PANDOC_VERSION/$TARBALL"

curl -L "$URL" -o "$TEMP_DIR/$TARBALL"

# Extract the binary
tar -xzf "$TEMP_DIR/$TARBALL" -C "$TEMP_DIR"
mv "$TEMP_DIR/pandoc-$PANDOC_VERSION/bin/pandoc" "$PANDOC_BIN"

# Clean up
rm -rf "$TEMP_DIR"

# Make it executable
chmod +x "$PANDOC_BIN"

echo "✅ Pandoc $PANDOC_VERSION installed successfully to $PANDOC_BIN"

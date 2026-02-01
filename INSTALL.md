# Installation Guide

## Quick Install (1 Command!)

The easiest way to install opencode-history-search:

```bash
npx opencode-history-search
```

Or with Bun:

```bash
bunx opencode-history-search
```

**That's it!** The installer will:

- ✅ Detect your OpenCode directory
- ✅ Copy the tool to `~/.opencode/tool/history-search.ts`
- ✅ Create the description file `~/.opencode/tool/history-search.txt`
- ✅ Show you usage examples

Then restart OpenCode and start using it!

---

## Installation Methods

### 1. From npm (After Publishing)

```bash
npx opencode-history-search
```

### 2. From GitHub

```bash
npx github:joeyism/opencode-history-search
```

### 3. From Local Repository

```bash
# Clone the repository
git clone https://github.com/joeyism/opencode-history-search.git
cd opencode-history-search

# Install dependencies and build
bun install
bun run build

# Run the installer
bun run install:tool
```

### 4. Global Installation (Optional)

If you want to install it globally:

```bash
# Install globally
npm install -g opencode-history-search

# Then run the installer anytime
opencode-history-search
```

---

## Manual Installation (Advanced)

If you prefer to copy files manually:

```bash
# After cloning and building
cp dist/history-search.ts ~/.opencode/tool/history-search.ts
cp .opencode/tool-description.txt ~/.opencode/tool/history-search.txt
```

Or create the description manually:

```bash
cat > ~/.opencode/tool/history-search.txt << 'EOF'
Search through past conversation histories in the current repository.

Features:
- Keyword search (exact matches)
- Regex search (advanced patterns)
- Fuzzy search (typo-tolerant matching)
- Searches session titles, messages, tools, and file paths

Examples:
- "Search my history for 'storage'"
- "Search for 'storag' using fuzzy mode" (finds "storage")
EOF
```

---

## Verification

After installation, verify it worked:

1. **Check the files exist:**

   ```bash
   ls -lh ~/.opencode/tool/history-search.*
   ```

   You should see:

   ```
   ~/.opencode/tool/history-search.ts   (13KB)
   ~/.opencode/tool/history-search.txt  (753 bytes)
   ```

2. **Restart OpenCode**

3. **Test it:**

   ```
   You: Do you have a history search tool?
   AI: Yes, I have access to the history-search tool...
   ```

   ```
   You: Search my conversation history for "storage"
   AI: <uses the tool and shows results>
   ```

---

## Troubleshooting

### Installer can't find OpenCode directory

The installer looks for:

- `~/.opencode/tool/`
- `~/.config/opencode/tool/`

If your OpenCode uses a different directory, install manually:

```bash
cp dist/history-search.ts /your/custom/path/.opencode/tool/history-search.ts
```

### Permission denied

If you get permission errors:

```bash
chmod +x ~/.opencode/tool/history-search.ts
```

### Tool not showing up in OpenCode

1. Verify the files are in the right place
2. Restart OpenCode completely
3. Check OpenCode's tool directory setting

### Build errors

Make sure you have Bun installed:

```bash
curl -fsSL https://bun.sh/install | bash
```

Or use npm/yarn:

```bash
npm install
npm run build
```

---

## Updating

To update to the latest version:

```bash
# Pull latest changes (if installed from git)
cd opencode-history-search
git pull
bun run build

# Run installer again
bun run install:tool
```

Or with npx (will always get latest):

```bash
npx opencode-history-search@latest
```

---

## Uninstallation

To remove the tool:

```bash
rm ~/.opencode/tool/history-search.ts
rm ~/.opencode/tool/history-search.txt
```

Restart OpenCode and the tool will be gone.

---

## Next Steps

After installation, see [USAGE_IN_OPENCODE.md](./USAGE_IN_OPENCODE.md) for:

- Usage examples
- Search modes (keyword, regex, fuzzy)
- Common use cases
- Tips and best practices

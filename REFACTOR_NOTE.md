# refactor/app-tabs

Library and Device tab extractions are on this branch.

**App.tsx is currently broken (PLACEHOLDER)** due to a failed large-file push in automation.

## Fix (run on your machine)

```bash
git fetch origin
git checkout refactor/app-tabs

# Restore App.tsx from Jldata2, then apply the extractions:
git show origin/Jldata2:src/App.tsx > src/App.tsx

# Option A: if you have the sandbox commits locally, cherry-pick or merge them.
# Option B: ask Grok to re-push App.tsx once the large-file path works.
```

`LibraryTab.tsx` and `DeviceTab.tsx` on this branch are correct.

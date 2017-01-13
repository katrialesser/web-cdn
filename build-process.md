# Build Process

The build process is divided into multiple phases, each executed in order.

1. Assemble File Contents List
    1. Eval main-config.yml
    2. Fetch available versions from library repo
    3. Fetch/parse library config
    4. Assemble expected fileset JSON
2. Diff and Build
    1. Look at diffs between last fileset JSON (stored in git)
    2. Apply diffs (download and extract tarballs, copy designated files)
    3. Check into git on `contents` branch
3. Sync with deployment repo


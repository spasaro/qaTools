# GIT SDET HELPER – FLOW DOCUMENTATION

## Overview

This document summarizes the behavior of the three main flows implemented in the **Git SDET Helper** script.

The goal of the tool is to reduce human error when performing common Git workflows used by **SDET / QA engineers**, especially when working with:

- new feature branches
- existing PR branches
- local backups of in-progress changes
- restore backups

The script standardizes repetitive Git operations and enforces a safer sequence of actions.

---

## Flow 1 — Start Working From Scratch With a New Branch

### Purpose

Create a brand-new working branch starting from the latest `integration` branch and push it to `origin` so a Pull Request can be opened.

### Execution Steps

1. **Fetch the latest changes from remote**
   ```bash
   git fetch origin
   ```

2. **Check out the integration branch**
   ```bash
   git checkout integration
   ```

3. **Update integration to the latest state**
   ```bash
   git pull --ff-only origin integration
   ```

4. **Clean temporary test artifacts**
   ```bash
   git clean -f -- junit-results.xml
   ```

5. **Verify that the target branch does not already exist**
   - checks local branches
   - checks remote branches

6. **Create the new branch**
   ```bash
   git checkout -b feature/<TICKET>/...
   ```

7. **Stage all changes**
   ```bash
   git add .
   ```

8. **Display the files that will be included in the commit**
   ```bash
   git diff --cached --name-status
   ```

9. **Create the commit**
   ```bash
   git commit -m "[TICKET] Commit title"
   ```

10. **Push the new branch**
    ```bash
    git push -u origin branch-name
    ```

11. **Generate a Pull Request link**
    ```text
    https://github.com/<repo>/compare/integration...branch-name
    ```

### Risks Prevented by Flow 1

- Creating branches from an outdated `integration` branch
- Accidentally committing from the wrong base branch
- Pushing a branch that already exists remotely
- Forgetting to stage files before committing
- Accidentally including unexpected files in a commit
- Forgetting to push the branch upstream
- Opening a PR against the wrong base branch

---

## Flow 2 — Work on a PR Fix

### Purpose

Safely update an existing Pull Request branch with additional fixes while keeping it rebased on the latest `integration`.

### Execution Steps

1. **Fetch the latest changes**
   ```bash
   git fetch origin
   ```

2. **Check out the target PR branch**
   - if the branch exists locally → checkout
   - if the branch only exists remotely → create a tracking branch

3. **Clean temporary test artifacts**
   ```bash
   git clean -f -- junit-results.xml
   ```

4. **Detect local changes**
   - if changes exist:
   ```bash
   git stash push -u
   ```

5. **Rebase the branch on top of the latest integration**
   ```bash
   git rebase origin/integration
   ```

6. **Restore stashed changes (if any)**
   ```bash
   git stash pop
   ```

7. **Stage the changes**
   ```bash
   git add .
   ```

8. **Display the files that will be included in the commit**
   ```bash
   git diff --cached --name-status
   ```

9. **Create the commit**
   ```bash
   git commit -m "[TICKET] Commit title"
   ```

10. **Push the update to the branch**
    ```bash
    git push --force-with-lease origin branch-name
    ```

11. **Display the Pull Request link**
    ```text
    https://github.com/<repo>/compare/integration...branch-name
    ```

### Risks Prevented by Flow 2

- Performing a rebase with a dirty working directory
- Losing local changes during a rebase
- Rebasing on an outdated `integration` branch
- Accidentally committing unrelated files
- Forgetting to re-stage files after restoring stash
- Using unsafe force pushes (`--force-with-lease` helps prevent overwriting remote changes unexpectedly)
- Creating extra merge commits instead of keeping a clean linear history

---

## Flow 3 — Backup Current Work

### Purpose

Create a local backup of the current working state before making risky changes or switching context.

This flow generates:

- a `.txt` summary file with repository and modified-file information
- a backup folder containing copies of modified and untracked files

The backup is stored inside a `git-backups` directory on the Desktop.

### What the Backup Includes

The backup summary contains information such as:

```text
Repository: tc-www
Branch: integration
Created at: Thu Mar 12 17:57:41 -03 2026

git status --short
 M spec/e2e/pages/cart-page.ts
 M spec/e2e/pages/payment-method/confirm-information-page.ts
 M spec/e2e/pages/payment-method/order-summary-page.ts
 M spec/e2e/utils/constants/prices.constants.ts
 M spec/e2e/utils/steps/checkout-flow.steps.ts
 M spec/e2e/utils/steps/confirm-information.steps.ts
 M spec/e2e/utils/steps/order-summary.steps.ts
?? junit-results.xml
?? spec/e2e/tests/tc-www/tax-avalara/
?? spec/e2e/utils/constants/avalara.constants.ts
?? spec/e2e/utils/helpers/avalara.helpers.ts
```

### Execution Steps

1. **Identify the current repository**
2. **Detect the current branch**
3. **Capture the current timestamp**
4. **Run `git status --short`**
5. **Generate a plain text summary**
6. **Create a backup folder inside `~/Desktop/git-backups/`**
7. **Copy modified and untracked files into that folder**
8. **Preserve the folder structure when possible**
9. **Save the `.txt` summary alongside the copied files**

### Risks Prevented by Flow 3

- Losing local work before a rebase or branch switch
- Forgetting which files were changed
- Accidentally deleting untracked work
- Overwriting in-progress files without a fallback
- Losing context when returning to the task later

### Recommended Use Cases for Backup

Use Flow 3 when:

- you want a safety snapshot before rebasing
- you are about to switch branches
- you want to preserve work before cleaning the repo
- you need a quick archive of local changes
- you want an auditable summary of what was modified

---

## Why This Script Reduces Human Error

Manual Git workflows frequently fail because engineers:

- forget to fetch before branching
- start branches from outdated `integration`
- rebase with local modifications
- lose changes during stash/pop operations
- force push incorrectly
- commit unintended files
- switch context without preserving work

The script standardizes the workflow and enforces a safer sequence of operations, making it significantly harder to perform a dangerous Git action by mistake.

---

## Recommended Usage

### Use Flow 1 when:

- starting a new task
- implementing a new test
- creating a new automation feature

### Use Flow 2 when:

- addressing PR comments
- fixing lint issues
- updating failing tests in an existing PR

### Use Flow 3 when:

- you want a backup before risky Git operations
- you need to preserve work before a cleanup
- you want a local snapshot of all current changes

---

## How to Make the Script Executable

If your script is stored at:

```bash
/Users/dariospasaro/Desktop/scripts/git-flow.sh
```

run:

```bash
chmod +x /Users/dariospasaro/Desktop/scripts/git-flow.sh
```

This gives the file execution permissions.

### Verify it

```bash
ls -l /Users/dariospasaro/Desktop/scripts/git-flow.sh
```

You should see executable permissions in the output, for example:

```text
-rwxr-xr-x
```

---

## How to Run the Script Directly

Once the script is executable, you can run it with:

```bash
bash /Users/dariospasaro/Desktop/scripts/git-flow.sh
```

or directly:

```bash
/Users/dariospasaro/Desktop/scripts/git-flow.sh
```

---

## How to Add an Alias

To make the script easier to run, add an alias to your shell configuration file.

### For Zsh

Open your config file:

```bash
nano ~/.zshrc
```

Add this line:

```bash
alias gitflow="bash /Users/dariospasaro/Desktop/scripts/git-flow.sh"
```

Save and close the file, then reload the shell:

```bash
source ~/.zshrc
```

Now you can run:

```bash
gitflow
```

### For Bash

Open your config file:

```bash
nano ~/.bashrc
```

Add this line:

```bash
alias gitflow="bash /Users/dariospasaro/Desktop/scripts/git-flow.sh"
```

Reload the shell:

```bash
source ~/.bashrc
```

---

## Optional: Add a Shell Function Instead of an Alias

If you want a command that looks slightly more customizable, you can use a shell function.

Example for `~/.zshrc`:

```bash
gitflow() {
  bash /Users/dariospasaro/Desktop/scripts/git-flow.sh
}
```

Then reload:

```bash
source ~/.zshrc
```

---

## Suggested Command Naming

Recommended command:

```bash
gitflow
```

This is short, easy to remember, and practical for daily use.

If you prefer something more explicit, alternatives include:

- `gitsdet`
- `githelper`
- `git-sdet-helper`

---

## Flow 4 : Restore Back Up

### 1. Select Restore Option

```
4) Restore backup
```

---

### 2. List Available Backups

The script scans:

```
~/Desktop/git-backups
```

And displays available backup folders in a numbered list.

---

### 3. Select Backup

You choose the backup using an interactive selector:

```
Select a backup folder:
1) tc-www-2026-03-12_17-57-41
2) tc-www-2026-03-13_10-22-11
```

---

### 4. Preview Backup Contents

Before restoring, the script shows:

#### Backup metadata

```
Repository: tc-www
Repository Path: /Users/.../tc-www
Branch: integration
Created at: ...
```

#### Files included

```
spec/e2e/pages/cart-page.ts
spec/e2e/utils/constants/prices.constants.ts
...
```

---

### 5. Confirm Restore

```
Confirm execution? (y/n):
```

---

### 6. Restore Execution

The script:

- resolves the correct repository path
- recreates folder structure
- copies files back into the repo

Equivalent behavior:

```bash
cp backup_file → repo_path/file
```

---

## Restore Logic

### Repository Resolution

The script determines where to restore files using:

1. **Repository Path (preferred)**
   - stored during backup
   - allows restore from anywhere

2. **Fallback (older backups)**
   - matches repository name
   - requires you to be inside the correct repo

---

## Output Example

```
Restoring files into repository: /Users/.../tc-www
Restore completed into: /Users/.../tc-www
Restored files: 8
```

---

## Important Behavior

### Overwrite Policy

- Files are **overwritten without prompt**
- This is intentional and assumes user awareness

---

## Risks (Accepted by Design)

- Overwriting current local changes
- Restoring into a different branch
- Reintroducing outdated files

---

## When to Use

Use Flow 4 when:

- you lost local changes
- you accidentally deleted files
- a rebase or reset went wrong
- you need to recover untracked files
- you want to restore a previous working state

---

## Compatibility Notes

### New Backups

- include `Repository Path`
- can be restored from anywhere

### Old Backups

- may not include path
- require running restore inside the correct repository


## Final Notes

This script is especially useful for teams that:

- work heavily with PR-based development
- use `integration` as the main merge base
- frequently create test automation branches
- need a safer and more repeatable Git workflow

It is not meant to replace Git knowledge. Its purpose is to **standardize repetitive actions**, **reduce mistakes**, and **speed up routine SDET workflows**.

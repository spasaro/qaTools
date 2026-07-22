#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

FLOW=''
BRANCH_NAME=''
TICKET_ID=''
COMMIT_TITLE=''
SELECTED_BACKUP_DIR=''

print_info() {
  printf "${BLUE}%s${NC}\n" "$1"
}

print_ok() {
  printf "${GREEN}%s${NC}\n" "$1"
}

print_warn() {
  printf "${YELLOW}%s${NC}\n" "$1"
}

print_error() {
  printf "${RED}%s${NC}\n" "$1"
}

abort() {
  print_error "$1"
  exit 1
}

require_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || abort 'You are not inside a Git repository.'
}

require_clean_rebase_state() {
  local git_dir
  git_dir="$(git rev-parse --git-dir)"
  if [[ -d "${git_dir}/rebase-merge" || -d "${git_dir}/rebase-apply" ]]; then
    abort 'A rebase operation is already in progress. Please resolve it before continuing.'
  fi
}

extract_ticket_id() {
  local slug="$1"
  if [[ "$slug" =~ ^([A-Z][A-Z0-9]+-[0-9]+)([-/].+)?$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

default_title_from_slug() {
  local slug="$1"
  local rest
  rest="$(printf '%s' "$slug" | sed -E 's#^[^/]*/##' | sed -E 's/^[A-Z][A-Z0-9]+-[0-9]+([-/])?//')"
  if [[ -z "$rest" ]]; then
    printf '%s\n' ''
    return 0
  fi
  printf '%s\n' "$rest" | tr '/-' '  '
}

branch_exists_local() {
  git show-ref --verify --quiet "refs/heads/$1"
}

branch_exists_remote() {
  git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1
}

checkout_target_branch() {
  local branch_name="$1"

  if branch_exists_local "$branch_name"; then
    git checkout -q "$branch_name"
    return 0
  fi

  if branch_exists_remote "$branch_name"; then
    git checkout -q -b "$branch_name" --track "origin/$branch_name"
    return 0
  fi

  abort "Branch does not exist locally or remotely: $branch_name"
}

run_add_and_commit() {
  local commit_message="$1"
  local confirm

  git add .

  if git diff --cached --quiet; then
    print_warn 'No staged changes detected. Skipping commit.'
    return 0
  fi

  printf "\n${CYAN}Files staged for commit:${NC}\n"
  git diff --cached --name-status

  read -e -r -p "Proceed with commit? (y/n): " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || abort 'Commit aborted.'

  HUSKY=0 git commit -m "$commit_message"
}

run_push_new_branch() {
  local branch_name="$1"
  git push -u origin "$branch_name"
}

run_push_force() {
  local branch_name="$1"
  git push --force-with-lease origin "$branch_name"
}

run_clean_junit() {
  git clean -f -- junit-results.xml >/dev/null 2>&1 || true
}

get_repo_http_url() {
  local remote_url
  remote_url="$(git config --get remote.origin.url)"

  if [[ -z "$remote_url" ]]; then
    abort 'remote.origin.url was not found.'
  fi

  if [[ "$remote_url" == git@github.com:* ]]; then
    printf '%s\n' "$remote_url" | sed -E 's#git@github.com:(.*)\.git#https://github.com/\1#'
    return 0
  fi

  if [[ "$remote_url" == https://github.com/* ]]; then
    printf '%s\n' "$remote_url" | sed -E 's#\.git$##'
    return 0
  fi

  abort "Unsupported remote origin for PR link generation: $remote_url"
}

print_pr_link() {
  local branch_name="$1"
  local repo_url
  local pr_url

  repo_url="$(get_repo_http_url)"
  pr_url="${repo_url}/compare/integration...${branch_name}"

  printf "\n${CYAN}Create Pull Request:${NC}\n"
  printf "%s\n\n" "$pr_url"
}

show_detected_changes() {
  printf "\n${CYAN}Changes to be included in commit:${NC}\n"

  if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
    printf "No local changes detected.\n"
    return 0
  fi

  git status --short
}

backup_changed_files() {
  local repo_name
  local repo_path
  local backup_root
  local backup_dir
  local status_file
  local changed_output
  local line
  local status
  local source_part
  local target_path
  local file_count

  repo_name="$(basename "$(git rev-parse --show-toplevel)")"
  repo_path="$(git rev-parse --show-toplevel)"
  backup_root="$HOME/Desktop/git-backups"
  backup_dir="${backup_root}/${repo_name}-$(date +%Y-%m-%d_%H-%M-%S)"
  status_file="${backup_dir}/git-status.txt"

  mkdir -p "$backup_dir"

  changed_output="$(git status --porcelain)"

  {
    printf "Repository: %s\n" "$repo_name"
    printf "Repository Path: %s\n" "$repo_path"
    printf "Branch: %s\n" "$(git branch --show-current)"
    printf "Created at: %s\n\n" "$(date)"
    printf "git status --short\n"
    git status --short
  } > "$status_file"

  if [[ -z "$changed_output" ]]; then
    print_warn "No local changes detected. Backup folder created with status report only: $backup_dir"
    return 0
  fi

  file_count=0

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    status="${line:0:2}"
    source_part="${line:3}"

    if [[ "$status" == R* || "$status" == *R ]]; then
      target_path="${source_part##* -> }"
    else
      target_path="$source_part"
    fi

    if [[ -f "$target_path" ]]; then
      mkdir -p "${backup_dir}/$(dirname "$target_path")"
      cp "$target_path" "${backup_dir}/$target_path"
      file_count=$((file_count + 1))
    fi
  done <<< "$changed_output"

  if [[ "$file_count" -eq 0 ]]; then
    print_warn "No existing files were copied. Backup folder created with status report only: $backup_dir"
    return 0
  fi

  print_ok "Backup completed: $backup_dir"
  print_info "Copied files: $file_count"
  print_info "Status report: $status_file"
}

list_backup_directories() {
  local backup_root
  backup_root="$HOME/Desktop/git-backups"

  [[ -d "$backup_root" ]] || return 0

  find "$backup_root" -mindepth 1 -maxdepth 1 -type d | sort -r
}

prompt_backup_selection() {
  local backups=()
  local selected=''

  while IFS= read -r line; do
    [[ -n "$line" ]] && backups+=("$line")
  done < <(list_backup_directories)

  [[ "${#backups[@]}" -gt 0 ]] || abort "No backup folders found in $HOME/Desktop/git-backups"

  printf "\n${CYAN}Available backups:${NC}\n"

  PS3='Select a backup folder: '
  select selected in "${backups[@]}"; do
    if [[ -n "${selected:-}" ]]; then
      SELECTED_BACKUP_DIR="$selected"
      return 0
    fi
    print_warn 'Invalid option. Please select a valid backup folder number.'
  done
}

show_selected_backup_contents() {
  local backup_dir="$1"
  local status_file="${backup_dir}/git-status.txt"

  printf "\n${CYAN}Selected backup:${NC}\n"
  printf "%s\n" "$backup_dir"

  if [[ -f "$status_file" ]]; then
    printf "\n${CYAN}Backup summary:${NC}\n"
    cat "$status_file"
  else
    print_warn 'git-status.txt was not found in the selected backup.'
  fi

  printf "\n${CYAN}Files available to restore:${NC}\n"
  find "$backup_dir" -type f ! -name 'git-status.txt' | sed "s#^${backup_dir}/##" | sort
}

get_backup_repo_name() {
  local backup_dir="$1"
  local status_file="${backup_dir}/git-status.txt"

  [[ -f "$status_file" ]] || return 1

  awk -F': ' '/^Repository:/ { print $2; exit }' "$status_file"
}

get_backup_repo_path() {
  local backup_dir="$1"
  local status_file="${backup_dir}/git-status.txt"

  [[ -f "$status_file" ]] || return 1

  awk -F': ' '/^Repository Path:/ { print $2; exit }' "$status_file"
}

resolve_restore_repo_path() {
  local backup_dir="$1"
  local repo_name=''
  local repo_path=''

  repo_name="$(get_backup_repo_name "$backup_dir" || true)"
  repo_path="$(get_backup_repo_path "$backup_dir" || true)"

  if [[ -n "$repo_path" && -d "$repo_path/.git" ]]; then
    printf '%s\n' "$repo_path"
    return 0
  fi

  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local current_repo_path
    local current_repo_name
    current_repo_path="$(git rev-parse --show-toplevel)"
    current_repo_name="$(basename "$current_repo_path")"

    if [[ -n "$repo_name" && "$current_repo_name" == "$repo_name" ]]; then
      printf '%s\n' "$current_repo_path"
      return 0
    fi
  fi

  abort 'Could not resolve the target repository path for this backup. For old backups without Repository Path, run restore from inside the correct repository.'
}

restore_backup_files() {
  local backup_dir="$1"
  local repo_path
  local status_file
  local file
  local relative_path
  local destination_path
  local restored_count

  repo_path="$(resolve_restore_repo_path "$backup_dir")"
  status_file="${backup_dir}/git-status.txt"
  restored_count=0

  print_info "Restoring files into repository: $repo_path"

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    relative_path="${file#${backup_dir}/}"
    destination_path="${repo_path}/${relative_path}"
    mkdir -p "$(dirname "$destination_path")"
    cp "$file" "$destination_path"
    restored_count=$((restored_count + 1))
  done < <(find "$backup_dir" -type f ! -name 'git-status.txt' | sort)

  if [[ "$restored_count" -eq 0 ]]; then
    print_warn 'No files were restored. The selected backup only contains a status report.'
    return 0
  fi

  print_ok "Restore completed into: $repo_path"
  print_info "Restored files: $restored_count"

  if [[ -f "$status_file" ]]; then
    print_info "Backup summary used: $status_file"
  fi
}

run_from_scratch() {
  local branch_name="$1"
  local commit_message="$2"

  print_info 'Flow selected: Start working from scratch with a new branch'
  print_info 'Fetching latest changes from origin...'
  git fetch origin

  print_info 'Checking out integration...'
  git checkout -q integration

  print_info 'Pulling latest integration changes...'
  git pull --ff-only origin integration

  print_info 'Cleaning junit-results.xml if present...'
  run_clean_junit

  if branch_exists_local "$branch_name" || branch_exists_remote "$branch_name"; then
    abort "Branch already exists: $branch_name"
  fi

  print_info "Creating new branch: $branch_name"
  git checkout -q -b "$branch_name"

  print_info 'Preparing commit...'
  run_add_and_commit "$commit_message"

  print_info "Pushing new branch to origin: $branch_name"
  run_push_new_branch "$branch_name"

  print_pr_link "$branch_name"
}

run_fix_pr_comments() {
  local branch_name="$1"
  local commit_message="$2"
  local had_changes='false'
  local stash_ref=''

  print_info 'Flow selected: Work on a PR fix'

  print_info 'Fetching latest changes from origin...'
  git fetch origin

  print_info "Checking out target branch: $branch_name"
  checkout_target_branch "$branch_name"

  print_info 'Cleaning junit-results.xml if present...'
  run_clean_junit

  if has_local_changes; then
    had_changes='true'
    print_info 'Local changes detected. Creating stash with untracked files...'
    git stash push -u -m "qa-flow-auto-stash" >/dev/null
    stash_ref='stash@{0}'
    print_info "Changes stashed as: $stash_ref"
  else
    print_info 'No local changes detected. No stash needed.'
  fi

  print_info 'Rebasing branch on top of origin/integration...'
  git rebase origin/integration

  if [[ "$had_changes" == 'true' ]]; then
    print_info "Restoring stashed changes from: $stash_ref"
    git stash pop "$stash_ref"
  fi

  print_info 'Preparing commit...'
  run_add_and_commit "$commit_message"

  print_info "Pushing updates to remote branch: $branch_name"
  run_push_force "$branch_name"

  print_pr_link "$branch_name"
}

prompt_flow() {
  local flow_input

  while true; do
    printf "\n${CYAN}GIT FLOW Helper${NC}\n"
    printf "${GREEN}1)${NC} Start working from scratch with a new branch\n"
    printf "${GREEN}2)${NC} Work on a PR fix\n"
    printf "${GREEN}3)${NC} Back up files\n"
    printf "${GREEN}4)${NC} Restore backup\n\n"

    read -e -r -p "Select option: " flow_input

    case "$flow_input" in
      1|2|3|4)
        FLOW="$flow_input"
        return 0
        ;;
      *)
        print_warn 'Invalid option. Please enter 1, 2, 3 or 4.'
        ;;
    esac
  done
}

prompt_branch_name() {
  local branch_input
  local ticket_id_input

  while true; do
    read -e -r -p "Enter full branch name (example: feature/... or fix/...): " branch_input

    if [[ -z "$branch_input" ]]; then
      print_warn 'Branch name cannot be empty.'
      continue
    fi

    if ticket_id_input="$(extract_ticket_id "${branch_input#*/}")"; then
      BRANCH_NAME="$branch_input"
      TICKET_ID="$ticket_id_input"
      return 0
    fi

    print_warn 'Branch must include a ticket like feature/QAE2ETC-1402-... or feature/QAE2ETC-1402/...'
  done
}

prompt_commit_title() {
  local default_title
  local title_input

  default_title="$(default_title_from_slug "$BRANCH_NAME")"

  while true; do
    if [[ -n "$default_title" ]]; then
      read -e -r -p "Enter commit title [${default_title}]: " title_input
      title_input="${title_input:-$default_title}"
    else
      read -e -r -p "Enter commit title: " title_input
    fi

    if [[ -n "$title_input" ]]; then
      COMMIT_TITLE="$title_input"
      return 0
    fi

    print_warn 'Commit title cannot be empty.'
  done
}

prompt_commit_confirmation() {
  local confirm_input

  while true; do
    printf "\n${CYAN}Commit preview${NC}\n"
    printf "${GREEN}[%s] %s${NC}\n" "$TICKET_ID" "$COMMIT_TITLE"

    show_detected_changes
    printf "\n"

    read -e -r -p "Are you ok with this commit? (y/n): " confirm_input

    case "$confirm_input" in
      y|Y)
        return 0
        ;;
      n|N)
        prompt_commit_title
        ;;
      *)
        print_warn 'Please enter y or n.'
        ;;
    esac
  done
}

has_local_changes() {
  ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]
}

prompt_confirmation() {
  local confirm_input

  while true; do
    read -e -r -p "Confirm execution? (y/n): " confirm_input

    case "$confirm_input" in
      y|Y)
        return 0
        ;;
      n|N)
        abort 'Operation cancelled.'
        ;;
      *)
        print_warn 'Please enter y or n.'
        ;;
    esac
  done
}

main() {
  local commit_message=''

  prompt_flow

  if [[ "$FLOW" == '1' || "$FLOW" == '2' || "$FLOW" == '3' ]]; then
    require_git_repo
  fi

  if [[ "$FLOW" == '1' || "$FLOW" == '2' ]]; then
    require_clean_rebase_state
    prompt_branch_name
    prompt_commit_title
    prompt_commit_confirmation
    commit_message="[${TICKET_ID}] ${COMMIT_TITLE}"
  fi

  if [[ "$FLOW" == '4' ]]; then
    prompt_backup_selection
    show_selected_backup_contents "$SELECTED_BACKUP_DIR"
  fi

  printf "\n${CYAN}Summary${NC}\n"
  printf "${GREEN}Flow:${NC} %s\n" "$FLOW"

  if [[ "$FLOW" == '1' || "$FLOW" == '2' || "$FLOW" == '3' ]]; then
    printf "${GREEN}Repository:${NC} %s\n" "$(basename "$(git rev-parse --show-toplevel)")"
  fi

  if [[ "$FLOW" == '1' || "$FLOW" == '2' ]]; then
    printf "${GREEN}Branch:${NC} %s\n" "$BRANCH_NAME"
    printf "${GREEN}Commit:${NC} %s\n" "$commit_message"
    show_detected_changes
  fi

  if [[ "$FLOW" == '3' ]]; then
    printf "\n${CYAN}Files to back up:${NC}\n"
    if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
      printf "No local changes detected.\n"
    else
      git status --short
    fi
  fi

  if [[ "$FLOW" == '4' ]]; then
    printf "${GREEN}Selected backup:${NC} %s\n" "$SELECTED_BACKUP_DIR"
  fi

  printf "\n"
  prompt_confirmation

  case "$FLOW" in
    1)
      run_from_scratch "$BRANCH_NAME" "$commit_message"
      ;;
    2)
      run_fix_pr_comments "$BRANCH_NAME" "$commit_message"
      ;;
    3)
      backup_changed_files
      ;;
    4)
      restore_backup_files "$SELECTED_BACKUP_DIR"
      ;;
  esac

  print_ok 'Done.'
}

main "$@"

#!/usr/bin/env bash
# Sprint 0 GitHub setup for the CSG Attendance Tracker capstone
# Usage: gh auth login (once), then run this from inside your cloned repo:
#   chmod +x setup_sprint0.sh && ./setup_sprint0.sh

set -euo pipefail

# Prevent Git Bash / MSYS on Windows from rewriting API path args (e.g. "/milestones")
# into Windows filesystem paths like "C:/Program Files/Git/milestones".
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

REPO="${1:-}"  # optional: pass owner/repo, e.g. ./setup_sprint0.sh marlyn/csg-attendance-tracker
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi
REPO_FLAG=(--repo "$REPO")

echo "==> Creating labels"
declare -A LABELS=(
  [backend]="1d76db"
  [frontend]="0e8a16"
  [design]="fbca04"
  [docs]="c5def5"
  [shared]="5319e7"
  [risk]="d73a4a"
  [marlyn]="ededed"
  [sasha]="ededed"
)
for name in "${!LABELS[@]}"; do
  gh label create "$name" --color "${LABELS[$name]}" "${REPO_FLAG[@]}" --force
done

echo "==> Creating milestone"
MILESTONE_TITLE="Sprint 0 - Catch-Up Setup and Design"

EXISTING_MILESTONE=$(gh api --method GET "repos/$REPO/milestones" -f state=all --jq \
  ".[] | select(.title == \"$MILESTONE_TITLE\") | .number" 2>/dev/null || true)

if [[ -n "$EXISTING_MILESTONE" ]]; then
  echo "Milestone already exists (#$EXISTING_MILESTONE) — skipping creation"
else
  gh api "repos/$REPO/milestones" \
    -f title="$MILESTONE_TITLE" \
    -f state="open" \
    -f due_on="2026-08-24T23:59:59Z" \
    -f description="Lock the shared contract fast so Marlyn (backend) and Sasha (frontend) can build in parallel from Sprint 1. Deliverables: locked GraphQL/DynamoDB schema, finalized wireframes, deployed empty backend, running app shell."
  echo "Milestone created."
fi

echo "==> Creating issues"

create_issue () {
  local title="$1"
  local body="$2"
  local labels="$3"
  gh issue create "${REPO_FLAG[@]}" \
    --title "$title" \
    --body "$body" \
    --label "$labels" \
    --milestone "$MILESTONE_TITLE"
}

create_issue "Finalize use case, class, and ER diagrams" \
"Owner: Both
Acceptance criteria:
- Use case diagram covers Teacher, Administrator, Parent, AWS Cloud Backend actors
- Class diagram matches AttendanceRecord/SyncQueue/NotificationLog structure from proposal Ch.3
- ER diagram uses classDateId (PK) / studentId (SK) composite key with GSI on studentId
- Diagrams committed to /docs/architecture" \
"shared,design"

create_issue "Lock GraphQL schema" \
"Owner: Both
Acceptance criteria:
- Schema aligns to CSG shared types (school_id, created_at, updated_at, created_by, status)
- AttendanceRecord, Student, Class, Teacher types defined per CSG Volume 2 Section 3.2
- Schema committed to /graphql/schema" \
"shared,backend"

create_issue "Lock DynamoDB design" \
"Owner: Both
Acceptance criteria:
- Partition key classDateId, sort key studentId confirmed
- GSI on studentId for attendance history queries
- No cross-school partitions (per CSG platform standard)
- Design doc committed to /docs/architecture" \
"shared,backend"

create_issue "Provision AWS account / confirm Free Tier limits" \
"Owner: Marlyn
Acceptance criteria: AWS account accessible by both team members, Free Tier limits documented for AppSync/DynamoDB" \
"backend,marlyn"

create_issue "CloudFormation skeleton" \
"Owner: Marlyn
Acceptance criteria: Empty stacks scaffolded for auth, api, data (mirrors CSG CDK stack layout) and committed to /infra" \
"backend,marlyn"

create_issue "Cognito user pool + role groups" \
"Owner: Marlyn
Acceptance criteria: User pool live with teacher/admin/parent groups matching CSG authorization matrix" \
"backend,marlyn"

create_issue "Deploy empty AppSync API" \
"Owner: Marlyn
Acceptance criteria: API deployed and reachable; returns valid (empty) schema response, not just 'created' in console" \
"backend,marlyn"

create_issue "Scaffold React PWA" \
"Owner: Sasha
Acceptance criteria: Routing in place, service worker registered, app shell runs locally" \
"frontend,sasha"

create_issue "Wireframe: Login screen" \
"Owner: Sasha
Acceptance criteria: Phone field, password, offline-access notice shown per proposal 3.4.6" \
"frontend,design,sasha"

create_issue "Wireframe: Teacher dashboard" \
"Owner: Sasha
Acceptance criteria: Class roster, present/absent toggles, bulk actions, sync-status indicator shown" \
"frontend,design,sasha"

create_issue "Wireframe: Admin dashboard" \
"Owner: Sasha
Acceptance criteria: Date filters, attendance trend charts, Claude AI summary panel, chronic-absentee list shown" \
"frontend,design,sasha"

create_issue "Agree Git branching strategy + shared sprint board" \
"Owner: Both
Acceptance criteria: feature/* and bugfix/* branch convention documented in README; sprint board set up and linked here" \
"shared"

create_issue "Risk: confirm mock API fallback if AWS access is delayed" \
"Owner: Sasha
Acceptance criteria: Local mock API ready so frontend work isn't blocked if AWS approval slips" \
"risk,frontend"

echo "==> Done. Review issues and milestone on GitHub."
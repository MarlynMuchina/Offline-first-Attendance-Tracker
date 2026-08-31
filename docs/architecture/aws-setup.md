# AWS Account Setup — Sprint 0 (Interim, Pre-Angaza-Credentials)

**Status:** In progress
**Owner:** Marlyn Muchina

## Why an interim account

Angaza has not yet issued CSG platform AWS credentials. Per the roadmap Phase 0
mitigation ("if blocked, Sasha builds against a local mock API"), the backend side
uses a personal AWS Free Tier account so infrastructure work isn't blocked either.
All infrastructure is defined as code (CDK), so switching to Angaza's account later
is a config change (account ID + region in environment variables), not a rewrite.

## Steps

1. **Create/confirm AWS Free Tier account** at https://aws.amazon.com/free — use a
   personal email, not a Strathmore or Angaza address, since this is genuinely interim.
2. **Set a budget alert** immediately: AWS Console → Billing → Budgets → create a
   zero-spend / $1 threshold alert. AppSync + DynamoDB + Cognito at this scale should
   stay within Free Tier, but a runaway Lambda loop or forgotten resource can surprise you.
3. **Create an IAM user for CLI/CDK use** — do not use the root account for daily work.
   - IAM → Users → Add user → programmatic access
   - Attach `AdministratorAccess` for now (interim/dev only — tighten to least-privilege
     before any handoff, per CSG platform standard on IAM least-privilege)
   - Save the access key ID and secret — you'll need them for `aws configure`
4. **Install and configure AWS CLI:**
   ```bash
   aws configure
   # AWS Access Key ID: <from step 3>
   # AWS Secret Access Key: <from step 3>
   # Default region: af-south-1   (Cape Town — closest AWS region to Kenya;
   #                                 confirm this matches whatever region Angaza uses
   #                                 once credentials arrive, for consistency)
   # Default output format: json
   ```
5. **Bootstrap CDK in this account/region** (one-time, required before first deploy):
   ```bash
   cd infra
   npm install
   npx cdk bootstrap
   ```
6. **Deploy the auth and API stacks:**
   ```bash
   npx cdk deploy csg-attendance-auth-stack csg-attendance-api-stack
   ```
   This creates the Cognito user pool (with Admin/HeadTeacher/Teacher/Parent groups)
   and an empty AppSync API authorized against that pool.
7. **Verify:**
   - Cognito: AWS Console → Cognito → User pools → confirm `csg-attendance-user-pool`
     exists with the four groups.
   - AppSync: AWS Console → AppSync → confirm `csg-attendance-api` exists and the
     schema matches `graphql/schema/schema.graphql`. Run a test query in the console
     (it'll return empty/null since there are no resolvers yet — that's expected for
     Sprint 0's "empty backend" deliverable).

## When Angaza credentials arrive

1. Run `aws configure --profile angaza` to add a second named profile without
   overwriting your personal one.
2. Update `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` (or pass `--profile angaza`
   to `cdk deploy`) to target their account instead.
3. Re-run `npx cdk bootstrap --profile angaza` (bootstrapping is per-account).
4. Re-deploy: `npx cdk deploy --all --profile angaza`.
5. Confirm with Phanuel (industry mentor) whether the Attendance Tracker gets its
   own DynamoDB table or writes into Angaza's existing shared `csg_platform_data`
   table — this determines whether the `data_stack` (Sprint 1) creates a new table
   or just IAM permissions to write into theirs. **Ask this before Sprint 1 starts**,
   since it changes the data_stack design.
6. Decommission the personal AWS account resources (`cdk destroy` on the interim
   stacks) once the Angaza-account version is confirmed working, to avoid orphaned
   Free Tier resources.


# CSG Offline-First Student Attendance Tracker

A serverless, offline-first attendance tracking system built for rural schools with unreliable internet connectivity. Teachers record attendance locally on any device — data syncs automatically to the cloud once a connection is available.

---

## The Problem

Rural schools rely on paper registers to track student attendance. When a student is absent, the information takes days to reach administration or parents — by which point early intervention is no longer possible. This delay is a direct contributor to student dropout rates.

Standard cloud-based solutions don't work here: they require consistent internet access that most rural schools don't have.

---

## The Solution

An offline-first web application where:

- Teachers mark attendance on their device with **no internet required**
- Records are stored locally in the browser (IndexedDB via Dexie)
- Data **automatically syncs to AWS** the moment a connection is restored
- Administrators get a real-time dashboard with absenteeism analytics
- An AI-powered summary (Claude via Amazon Bedrock) flags at-risk students
- SMS alerts are sent to guardians when a student crosses an absenteeism threshold

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React PWA (Vite)                   │
│  Teacher UI  │  Admin Dashboard  │  Settings         │
│              │                   │                   │
│         IndexedDB (Dexie) — offline store            │
└──────────────────────┬──────────────────────────────┘
                       │ GraphQL (AWS AppSync)
                       │ syncs when online
┌──────────────────────▼──────────────────────────────┐
│                    AWS Backend                        │
│                                                       │
│  AppSync (GraphQL API)                               │
│  Lambda (business logic, validation, AI gateway)     │
│  DynamoDB (attendance records, students, classes)    │
│  Cognito (auth, school_id scoped per teacher)        │
│  Amazon Bedrock / Claude (AI attendance summaries)   │
│  Africa's Talking (SMS alerts to guardians)          │
│  S3 (audit log exports)                              │
└─────────────────────────────────────────────────────┘
```

**Infrastructure:** AWS CDK (TypeScript) — fully reproducible via `cdk deploy`

---

## Key Features

| Feature | Status |
|---|---|
| Offline attendance recording | ✅ Complete |
| Auto-sync with conflict resolution | ✅ Complete |
| Teacher dashboard (roster + mark attendance) | ✅ Complete |
| Admin dashboard with chronic absenteeism list | ✅ Complete |
| AI-generated attendance summary (Bedrock/Claude) | ✅ Complete |
| PDF export of attendance reports | ✅ Complete |
| SMS guardian alerts on absenteeism threshold | ✅ Complete |
| SMS audit log (last 30 days) | ✅ Complete |
| Role-based access control (Cognito groups) | ✅ Complete |
| Multi-school tenant isolation via school_id | ✅ Complete |
| Attendance risk prediction (logistic regression) | ✅ Complete |
| Storage quota management (IndexedDB safety) | ✅ Complete |

---

## Project Structure

```
├── frontend/               # React PWA (Vite)
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx           # Auth flow with Amplify
│       │   ├── Teacher.jsx         # Offline attendance marking
│       │   ├── Admin.jsx           # Dashboard, analytics, AI summary
│       │   └── AdminSettings.jsx   # Student management, SMS log
│       ├── lib/
│       │   ├── auth.js             # Reads school_id from Cognito token
│       │   ├── db.js               # Dexie (IndexedDB) schema
│       │   ├── syncEngine.js       # Offline queue → AppSync sync logic
│       │   ├── storageQuotaManager.js  # IndexedDB size safety
│       │   └── settings.js         # Configurable thresholds
│       └── components/
│           └── ProtectedRoute.jsx
│
├── infra/                  # AWS CDK stacks (TypeScript)
│   ├── lib/
│   │   ├── auth_stack.ts           # Cognito user pool + school_id attribute
│   │   ├── api_stack.ts            # AppSync GraphQL API
│   │   ├── database_stack.ts       # DynamoDB tables
│   │   └── lambda_stack.ts         # Lambda functions
│   └── scripts/
│       └── import-real-data/       # Data seeding scripts
│
├── graphql/
│   └── schema/                     # GraphQL schema definition
│
└── docs/
    └── architecture/               # Architecture documentation
```

---

## Tech Stack

**Frontend**
- React 18 + Vite
- Dexie (IndexedDB wrapper for offline storage)
- AWS Amplify (auth + GraphQL client)
- jsPDF (report export)

**Backend (AWS)**
- AWS AppSync — managed GraphQL API
- AWS Lambda — serverless business logic
- Amazon DynamoDB — scalable NoSQL database
- Amazon Cognito — authentication + per-school tenancy
- Amazon Bedrock (Claude) — AI attendance summaries
- Africa's Talking — SMS gateway for guardian alerts
- Amazon S3 — audit log storage

**Infrastructure**
- AWS CDK (TypeScript)
- AWS Region: `eu-north-1`

---

## Getting Started

### Prerequisites

- Node.js 18+
- AWS CLI configured with appropriate credentials
- AWS CDK installed (`npm install -g aws-cdk`)

### 1. Deploy the backend

```bash
cd infra
npm install
npx cdk deploy --all
```

### 2. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`

### 3. Seed test data (optional)

```bash
cd infra/scripts/import-real-data
node seed.js
```

This seeds 5 schools, 180 students, and 8,640 attendance records into DynamoDB.

---

## Multi-Tenant Design

Each teacher's Cognito account has a `custom:school_id` attribute (e.g. `SCH01`). On login, the app reads this from the ID token and uses it to scope all data queries — teachers can only see students from their own school.

> **Note:** `custom:school_id` is immutable in the Cognito pool schema. It must be set at user creation time using `admin-create-user`.

---

## Development Methodology

This project was developed using **Agile methodology** with iterative sprints:

| Milestone | Focus |
|---|---|
| Sprint 0 | Repo setup, AWS infrastructure, CDK stacks |
| Sprint 1 | Offline-first core — Dexie, sync engine, Teacher UI |
| Sprint 2 | Backend hardening — Lambda validation, RBAC, audit log, AI gateway |
| Sprint 3 | Admin dashboard, PDF export, SMS alerts, risk prediction |
| Phase 4 | Multi-tenant data seeding and school_id context wiring |
| Phase 5 | Testing, documentation, final integration |

---

## Contributors

- **Marlyn Muchina** — Backend infrastructure, AWS CDK, sync engine, Lambda functions, data seeding
- **Sasha Miriti** — Frontend (React), UI/UX, Admin dashboard, Teacher interface, auth flow

---

## Repository

[https://github.com/MarlynMuchina/Offline-first-Attendance-Tracker](https://github.com/MarlynMuchina/Offline-first-Attendance-Tracker)

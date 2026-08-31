# DynamoDB Design — Attendance Tracker

**Status:** Locked, Sprint 0
**Owner:** Marlyn Muchina

## Table

Single table, following the CSG platform standard (Engineering Framework Vol. 1, §8):

```
Table name: csg_attendance_data   (module-scoped table for Sprint 0/interim AWS account;
                                    if/when integrated into Angaza's shared
                                    csg_platform_data table, only the table name
                                    changes — key structure stays identical)
```

## Key structure

| | Pattern |
|---|---|
| Partition key (PK) | `SCHOOL#<school_id>` |
| Sort key (SK) | entity-prefixed, see below |

### SK patterns used by this module

```
STUDENT#<student_id>
TEACHER#<teacher_id>
CLASS#<class_id>
ATTENDANCE#<date>#<student_id>
NOTIFICATION#<notification_id>
SYNCMETA#<device_id>
```

This matches the CSG platform-wide SK convention (Vol. 1 §8) so the table can be merged
into the shared `csg_platform_data` table later without a schema rewrite — only a data
migration (copy items, same key shapes, different table name).

## Global Secondary Indexes (GSIs)

| Index | PK | SK | Purpose |
|---|---|---|---|
| GSI1 | `student_id` | `date` | Get a student's full attendance history (proposal §3.4.3) |
| GSI2 | `class_id` | `date` | Get a class's attendance for a given day/range (getClassRoster, dashboard) |
| GSI3 | `status#date` | `school_id` | Chronic-absenteeism queries — filter by ABSENT + recent date range |

## Access patterns this design supports

1. Get class roster for a specific date → Query PK, filter SK begins_with `ATTENDANCE#<date>`
2. Get a student's attendance history → Query GSI1 by `student_id`
3. Mark attendance (single or bulk) → PutItem / BatchWriteItem on `ATTENDANCE#<date>#<student_id>`
4. Get chronic absenteeism candidates (<70%) → Query GSI3, aggregate in Lambda
5. Sync conflict resolution → each `AttendanceRecord` item carries a `sync_version` (int,
   incremented per write) and `marked_at` (ISO timestamp); Lambda validation compares
   incoming vs. stored `marked_at` and applies last-write-wins per proposal §3.5.3.2

## Principles (per CSG Vol. 1 §8 / Vol. 2 §5)

- No cross-school partitions — every item's PK is scoped to one `school_id`.
- Sparse indexes where useful (e.g. GSI3 only populated for ABSENT records to keep it lean).
- This operational table serves live application queries only — analytics/reporting reads
  from the curated S3/QuickSight layer, never directly from this table (per platform
  standard: "No heavy reporting workloads should query the operational DynamoDB table
  directly").

## Deviation note from initial proposal draft

The original proposal (Ch. 3.4.3) described a standalone ERD with `classDateId` as the
partition key. This design supersedes that draft: the CSG-aligned `SCHOOL#<school_id>`
partition key is used instead, since this module is being built as the Attendance Tracker
component of the CSG platform, not a fully independent system. This keeps the table
mergeable into Angaza's shared platform later and satisfies the platform-level tenancy
standard (Vol. 1 §5: "Every tenant-scoped record must include school_id"). The
`classDateId`-style access pattern is preserved functionally via GSI2, not lost.

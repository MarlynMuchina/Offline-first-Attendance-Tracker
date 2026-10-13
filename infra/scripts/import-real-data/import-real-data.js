/**
 * import-real-data.js
 *
 * One-time migration script: loads the real industry dataset (from Angaza/
 * Edna) into the live DynamoDB tables. Run locally with your AWS CLI
 * credentials already configured (same account/region as the deployed app).
 *
 * Usage:
 *   node import-real-data.js --dry-run        # parse + validate only, no writes
 *   node import-real-data.js --cleanup-first   # delete old fake test data, then import
 *   node import-real-data.js                   # import only, leave existing data alone
 *   node import-real-data.js --remove          # delete only the records this import creates
 *
 * --remove must be given the same --school and --shift-to as the import it
 * undoes, since those decide the record ids. Classes, teachers and students
 * created in the app are never touched.
 *
 * Options (combine with any of the above):
 *   --school SCH01,SCH03    only import these schools (default: all five)
 *   --guardian-phone +2547XXXXXXXX   use this one number for every guardian
 *                           instead of the dataset's numbers ("none" leaves
 *                           them blank). Recommended for demos.
 *   --shift-to 2026-10-09   move every attendance date forward by whole weeks
 *                           so the term ends on or just before this date.
 *                           Weekdays stay the same. The dataset's term ran
 *                           2026-05-04 to 2026-07-10, which falls outside the
 *                           dashboard's default last-30-days window.
 *
 * Expects these CSVs in the same directory:
 *   CSG_Classes_Master.csv
 *   CSG_Students_Master.csv
 *   CSG_Guardian_Contacts_Cleaned.csv
 *   CSG_Attendance_Daily_Normalized.csv
 *
 * (CSG_Schools_Master.csv is NOT imported to DynamoDB -- there's no School
 * table in the schema. Its data instead seeds frontend/src/lib/schools.js,
 * a static lookup, since school metadata rarely changes and adding a full
 * @model School type would mean a new table + redeploy for little benefit.)
 *
 * (CSG_Attendance_Summary_Aggregated.csv and CSG_SMS_Notification_Alert_
 * Queue.csv are NOT imported either -- they're reference/ground-truth data
 * for validating the dashboard's own computed stats and the threshold-
 * trigger SMS logic, not raw source data.)
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = 'eu-north-1';
const TABLES = {
  Class: 'Class-wtgwzva7hvcrljtyfsbjgqiora-NONE',
  Student: 'Student-wtgwzva7hvcrljtyfsbjgqiora-NONE',
  AttendanceRecord: 'AttendanceRecord-wtgwzva7hvcrljtyfsbjgqiora-NONE',
};

const DRY_RUN = process.argv.includes('--dry-run');
const CLEANUP_FIRST = process.argv.includes('--cleanup-first');
const REMOVE = process.argv.includes('--remove');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

const SCHOOL_FILTER = argValue('--school') ? argValue('--school').split(',').map((s) => s.trim()) : null;
const SHIFT_TO = argValue('--shift-to');
// The dataset's guardian numbers may belong to real parents. Once a teacher
// marks an imported student absent, the threshold SMS looks at the whole
// imported history, so a low-attendance student would trigger a real text.
// --guardian-phone replaces every number with one test number, or "none"
// leaves them blank (alerts are then skipped for imported students).
const GUARDIAN_PHONE = argValue('--guardian-phone');
if (GUARDIAN_PHONE && GUARDIAN_PHONE !== 'none' && !/^\+254\d{9}$/.test(GUARDIAN_PHONE)) {
  console.error('--guardian-phone needs a number like +254712345678, or none');
  process.exit(1);
}
if (SHIFT_TO && !/^\d{4}-\d{2}-\d{2}$/.test(SHIFT_TO)) {
  console.error('--shift-to needs a date like 2026-10-09');
  process.exit(1);
}

function inScope(row) {
  return !SCHOOL_FILTER || SCHOOL_FILTER.includes(row.school_id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// "Form 2 North" -> { grade: "Form 2", stream: "North" }
function splitClassName(name) {
  const m = name.match(/^(Form \d+)\s+(.+)$/);
  return m ? { grade: m[1], stream: m[2] } : { grade: name, stream: '' };
}

const client = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(client);

function readCsv(filename) {
  const filePath = path.join(__dirname, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

// DynamoDB BatchWriteItem allows a max of 25 items per call, and can return
// UnprocessedItems under throttling -- this retries those with backoff
// rather than silently dropping records.
async function batchWriteAll(tableName, items) {
  const CHUNK_SIZE = 25;
  let written = 0;

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    let requestItems = {
      [tableName]: chunk.map((item) =>
        REMOVE ? { DeleteRequest: { Key: { id: item.id } } } : { PutRequest: { Item: item } }
      ),
    };

    let attempt = 0;
    while (Object.keys(requestItems).length > 0) {
      if (DRY_RUN) break;

      const result = await doc.send(new BatchWriteCommand({ RequestItems: requestItems }));
      requestItems = result.UnprocessedItems || {};

      if (Object.keys(requestItems).length > 0) {
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        console.log(`  ${Object.values(requestItems)[0].length} unprocessed, retrying in ${delay}ms (attempt ${attempt})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    written += chunk.length;
    const verb = DRY_RUN ? 'checked' : REMOVE ? 'removed' : 'written';
    process.stdout.write(`\r  ${tableName}: ${written}/${items.length} ${verb}`);
  }
  console.log();
}

async function deleteAllItems(tableName, keyName = 'id') {
  console.log(`Scanning ${tableName} for existing items to delete...`);
  let items = [];
  let lastKey;
  do {
    const res = await doc.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey }));
    items = items.concat(res.Items || []);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`  Found ${items.length} existing items in ${tableName}`);
  if (DRY_RUN) return;

  for (const item of items) {
    await doc.send(new DeleteCommand({ TableName: tableName, Key: { [keyName]: item[keyName] } }));
  }
  console.log(`  Deleted ${items.length} items from ${tableName}`);
}

async function main() {
  console.log(`=== CSG Real Data Import ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  if (REMOVE && CLEANUP_FIRST) {
    throw new Error('Use --remove or --cleanup-first, not both');
  }
  if (REMOVE) console.log('--- REMOVE mode: deleting the records listed below ---\n');

  if (CLEANUP_FIRST) {
    console.log('--- Cleanup: removing old test/seed data ---');
    await deleteAllItems(TABLES.AttendanceRecord);
    await deleteAllItems(TABLES.Student);
    await deleteAllItems(TABLES.Class);
    console.log();
  }

  const now = new Date().toISOString();

  // ---- Classes ----
  console.log('--- Importing Classes ---');
  const classesRaw = readCsv('CSG_Classes_Master.csv').filter(inScope);
  if (SCHOOL_FILTER && classesRaw.length === 0) {
    throw new Error(`No classes found for --school ${SCHOOL_FILTER.join(',')}`);
  }
  const classItems = classesRaw.map((c) => ({
    id: c.class_id,
    __typename: 'Class',
    school_id: c.school_id,
    name: c.class_name,
    ...splitClassName(c.class_name),
    created_at: now,
    updated_at: now,
  }));
  console.log(`  Parsed ${classItems.length} classes`);
  await batchWriteAll(TABLES.Class, classItems);

  // ---- Guardian phone lookup (primary contact only) ----
  console.log('\n--- Building guardian phone lookup ---');
  const guardiansRaw = readCsv('CSG_Guardian_Contacts_Cleaned.csv');
  const primaryPhoneByStudent = {};
  for (const g of guardiansRaw) {
    if (g.primary_contact === 'Yes') {
      primaryPhoneByStudent[g.student_id] = g.phone_number_e164;
    }
  }
  console.log(`  Found ${Object.keys(primaryPhoneByStudent).length} primary guardian contacts`);

  // ---- Students ----
  console.log('\n--- Importing Students ---');
  const studentsRaw = readCsv('CSG_Students_Master.csv').filter(inScope);
  const studentItems = studentsRaw.map((s) => ({
    id: s.student_id,
    __typename: 'Student',
    school_id: s.school_id,
    class_id: s.class_id,
    first_name: s.student_name.split(' ')[0],
    last_name: s.student_name.split(' ').slice(1).join(' ') || s.student_name.split(' ')[0],
    guardian_phone: GUARDIAN_PHONE === 'none'
      ? null
      : GUARDIAN_PHONE || primaryPhoneByStudent[s.student_id] || null,
    status: 'ACTIVE',
    created_at: now,
    updated_at: now,
  }));
  console.log(`  Parsed ${studentItems.length} students`);
  await batchWriteAll(TABLES.Student, studentItems);

  // ---- Attendance records ----
  console.log('\n--- Importing Attendance Records ---');
  const attendanceRaw = readCsv('CSG_Attendance_Daily_Normalized.csv').filter(inScope);
  const statusMap = { Present: 'PRESENT', Absent: 'ABSENT', Late: 'LATE' };

  let shiftDays = 0;
  if (SHIFT_TO) {
    const lastDate = attendanceRaw.reduce((max, a) => (a.date > max ? a.date : max), '');
    const gapDays = Math.round((Date.parse(SHIFT_TO) - Date.parse(lastDate)) / DAY_MS);
    shiftDays = Math.max(0, Math.floor(gapDays / 7) * 7);
    console.log(`  Shifting dates forward ${shiftDays} days: last day ${lastDate} -> ${addDays(lastDate, shiftDays)}`);
  }

  const attendanceItems = attendanceRaw.map((a) => {
    const date = addDays(a.date, shiftDays);
    return {
      // Rebuild the id from the shifted date so it still matches the record.
      id: `ATT#${a.school_id}#${a.student_id}#${date}`,
      __typename: 'AttendanceRecord',
      school_id: a.school_id,
      student_id: a.student_id,
      class_id: a.class_id,
      date,
      status: statusMap[a.status] || a.status.toUpperCase(),
      reason_code: a.reason_code === 'NONE' ? null : a.reason_code,
      marked_by: a.marked_by,
      marked_at: new Date(Date.parse(a.marked_at) + shiftDays * DAY_MS).toISOString(),
      created_at: now,
      updated_at: now,
    };
  });
  console.log(`  Parsed ${attendanceItems.length} attendance records`);
  await batchWriteAll(TABLES.AttendanceRecord, attendanceItems);

  console.log(`\n=== Import complete ${DRY_RUN ? '(dry run -- nothing was actually written)' : ''} ===`);
  console.log(`Classes: ${classItems.length}, Students: ${studentItems.length}, Attendance: ${attendanceItems.length}`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
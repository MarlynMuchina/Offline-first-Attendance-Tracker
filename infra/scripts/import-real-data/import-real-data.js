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
      [tableName]: chunk.map((item) => ({ PutRequest: { Item: item } })),
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
    process.stdout.write(`\r  ${tableName}: ${written}/${items.length} written`);
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
  const classesRaw = readCsv('CSG_Classes_Master.csv');
  const classItems = classesRaw.map((c) => ({
    id: c.class_id,
    __typename: 'Class',
    school_id: c.school_id,
    name: c.class_name,
    grade: c.class_name, // no separate grade/stream split in source data
    stream: '',
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
  const studentsRaw = readCsv('CSG_Students_Master.csv');
  const studentItems = studentsRaw.map((s) => ({
    id: s.student_id,
    __typename: 'Student',
    school_id: s.school_id,
    class_id: s.class_id,
    first_name: s.student_name.split(' ')[0],
    last_name: s.student_name.split(' ').slice(1).join(' ') || s.student_name.split(' ')[0],
    guardian_phone: primaryPhoneByStudent[s.student_id] || null,
    status: 'ACTIVE',
    created_at: now,
    updated_at: now,
  }));
  console.log(`  Parsed ${studentItems.length} students`);
  await batchWriteAll(TABLES.Student, studentItems);

  // ---- Attendance records ----
  console.log('\n--- Importing Attendance Records ---');
  const attendanceRaw = readCsv('CSG_Attendance_Daily_Normalized.csv');
  const statusMap = { Present: 'PRESENT', Absent: 'ABSENT', Late: 'LATE' };
  const attendanceItems = attendanceRaw.map((a) => ({
    id: a.attendance_id,
    __typename: 'AttendanceRecord',
    school_id: a.school_id,
    student_id: a.student_id,
    class_id: a.class_id,
    date: a.date,
    status: statusMap[a.status] || a.status.toUpperCase(),
    marked_by: a.marked_by,
    marked_at: a.marked_at,
    client_request_id: a.attendance_id, // reuse as a stable idempotency key
    created_at: now,
    updated_at: now,
  }));
  console.log(`  Parsed ${attendanceItems.length} attendance records`);
  await batchWriteAll(TABLES.AttendanceRecord, attendanceItems);

  console.log(`\n=== Import complete ${DRY_RUN ? '(dry run -- nothing was actually written)' : ''} ===`);
  console.log(`Classes: ${classItems.length}, Students: ${studentItems.length}, Attendance: ${attendanceItems.length}`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
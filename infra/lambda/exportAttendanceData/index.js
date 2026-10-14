const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);
const s3 = new S3Client({});

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;
const STUDENT_TABLE = process.env.STUDENT_TABLE;
const CLASS_TABLE = process.env.CLASS_TABLE;
const EXPORT_BUCKET = process.env.EXPORT_BUCKET;
// Every pilot school goes into one file, so a network-wide dashboard can be
// built from a single dataset. Override with a comma-separated SCHOOL_IDS.
const SCHOOL_IDS = (process.env.SCHOOL_IDS || 'SCH01,SCH02,SCH03,SCH04,SCH05')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

async function queryAllBySchool(tableName, indexName, schoolId) {
  const items = [];
  let lastKey;
  do {
    const res = await doc.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: 'school_id = :sid',
      ExpressionAttributeValues: { ':sid': schoolId },
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

exports.handler = async () => {
  const forAllSchools = async (tableName) =>
    (await Promise.all(SCHOOL_IDS.map((id) => queryAllBySchool(tableName, 'bySchool', id)))).flat();

  const [attendanceRecords, students, classes] = await Promise.all([
    forAllSchools(ATTENDANCE_TABLE),
    forAllSchools(STUDENT_TABLE),
    forAllSchools(CLASS_TABLE),
  ]);

  const studentMap = Object.fromEntries(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`]));
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]));

  const header = ['date', 'school_id', 'class_id', 'class_name', 'student_id', 'student_name', 'status', 'marked_by', 'marked_at'];
  const rows = attendanceRecords.map((r) => [
    r.date,
    r.school_id,
    r.class_id,
    classMap[r.class_id] || 'UNKNOWN',
    r.student_id,
    studentMap[r.student_id] || 'UNKNOWN',
    r.status,
    r.marked_by,
    r.marked_at,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');

  const today = new Date().toISOString().split('T')[0];
  const key = `exports/attendance/all-schools/${today}.csv`;

  await s3.send(new PutObjectCommand({
    Bucket: EXPORT_BUCKET,
    Key: key,
    Body: csv,
    ContentType: 'text/csv',
  }));

  console.log(`Exported ${rows.length} attendance records to s3://${EXPORT_BUCKET}/${key}`);
  return { exportedCount: rows.length, key };
};
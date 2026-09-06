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
const SCHOOL_ID = process.env.SCHOOL_ID || 'school-001'; // TODO: multi-school once Admin module exists

async function queryAllBySchool(tableName, indexName) {
  const items = [];
  let lastKey;
  do {
    const res = await doc.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: 'school_id = :sid',
      ExpressionAttributeValues: { ':sid': SCHOOL_ID },
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
  const [attendanceRecords, students, classes] = await Promise.all([
    queryAllBySchool(ATTENDANCE_TABLE, 'bySchool'),
    queryAllBySchool(STUDENT_TABLE, 'bySchool'),
    queryAllBySchool(CLASS_TABLE, 'bySchool'),
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
  const key = `exports/attendance/${SCHOOL_ID}/${today}.csv`;

  await s3.send(new PutObjectCommand({
    Bucket: EXPORT_BUCKET,
    Key: key,
    Body: csv,
    ContentType: 'text/csv',
  }));

  console.log(`Exported ${rows.length} attendance records to s3://${EXPORT_BUCKET}/${key}`);
  return { exportedCount: rows.length, key };
};
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);
const lambdaClient = new LambdaClient({});

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;
const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE;
const STUDENT_TABLE = process.env.STUDENT_TABLE;
const SEND_SMS_FUNCTION_NAME = process.env.SEND_SMS_FUNCTION_NAME;

const CONSECUTIVE_ABSENCE_THRESHOLD = 3;
const MONTHLY_RATE_THRESHOLD = 0.70;
const DEDUP_WINDOW_DAYS = 7;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

exports.handler = async (event) => {
  const detail = event.detail;

  if (!['CREATED', 'UPDATED'].includes(detail.action) || detail.status !== 'ABSENT') {
    return { skipped: true, reason: 'not a new/changed absence' };
  }

  const { student_id, school_id, class_id } = detail;

  const thirtyDaysAgo = daysAgo(30);
  const recordsRes = await doc.send(new QueryCommand({
  TableName: ATTENDANCE_TABLE,
  IndexName: 'byStudent',
  KeyConditionExpression: 'student_id = :sid',
  FilterExpression: '#d >= :start AND class_id = :cid',
  ExpressionAttributeNames: { '#d': 'date' },
  ExpressionAttributeValues: {
    ':sid': student_id,
    ':start': thirtyDaysAgo,
    ':cid': class_id,
  },
}));

  const records = (recordsRes.Items || []).sort((a, b) => a.date.localeCompare(b.date));

  let consecutiveAbsences = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].status === 'ABSENT') {
      consecutiveAbsences++;
    } else {
      break;
    }
  }
  const hitConsecutive = consecutiveAbsences >= CONSECUTIVE_ABSENCE_THRESHOLD;

  const total = records.length;
  const present = records.filter((r) => r.status !== 'ABSENT').length;
  const rate = total > 0 ? present / total : 1;
  const hitRateThreshold = total > 0 && rate < MONTHLY_RATE_THRESHOLD;

  if (!hitConsecutive && !hitRateThreshold) {
    return { triggered: false };
  }

  const dedupCutoff = daysAgo(DEDUP_WINDOW_DAYS);
  const recentAlerts = await doc.send(new QueryCommand({
    TableName: NOTIFICATION_TABLE,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    FilterExpression: 'created_at >= :cutoff',
    ExpressionAttributeValues: {
      ':sid': student_id,
      ':cutoff': dedupCutoff,
    },
  }));

  if ((recentAlerts.Items || []).length > 0) {
    return { triggered: true, skipped: 'already alerted within dedup window' };
  }

  const studentRes = await doc.send(new GetCommand({
    TableName: STUDENT_TABLE,
    Key: { id: student_id },
  }));
  const student = studentRes.Item;

  if (!student?.guardian_phone) {
    console.error(`No guardian_phone on file for student ${student_id}, cannot send alert`);
    return { triggered: true, skipped: 'no guardian phone on file' };
  }

  const reason = hitConsecutive
    ? `${consecutiveAbsences} consecutive absences`
    : `attendance rate ${Math.round(rate * 100)}% (below 70%)`;

  const message = `Attendance alert: ${student.first_name} ${student.last_name} has ${reason}. Please contact the school if you have questions.`;

  await lambdaClient.send(new InvokeCommand({
    FunctionName: SEND_SMS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify({
      school_id,
      student_id,
      guardian_phone: student.guardian_phone,
      message,
    }),
  }));

  return { triggered: true, reason };
};
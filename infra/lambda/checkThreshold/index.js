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

// Parents get at most two texts per student, one per stage:
//   WARNING    -- attendance has dropped below 70% (the early-warning line)
//   INELIGIBLE -- attendance has dropped below 2/3 (the exam eligibility line)
// Nothing is sent until the student has MIN_RECORDS marked days, so a single
// early absence (which reads as 0%) doesn't trigger a text.
const WARNING_RATE = 0.70;
const EXAM_ELIGIBILITY_RATE = 2 / 3;
const MIN_RECORDS = 10;

function formatPercent(rate) {
  return `${Math.floor(rate * 100)}%`;
}

function buildMessage(stage, student, rate) {
  const name = `${student.first_name} ${student.last_name}`;
  if (stage === 'INELIGIBLE') {
    return `CSG: ${name}'s attendance is ${formatPercent(rate)}, below the 67% minimum. They are not currently eligible to sit exams. Please contact the school.`;
  }
  return `CSG: ${name}'s attendance is ${formatPercent(rate)}, below 70%. Below 67% they will not be eligible to sit exams. Please contact the school.`;
}

exports.handler = async (event) => {
  const detail = event.detail;

  if (!['CREATED', 'UPDATED'].includes(detail.action) || detail.status !== 'ABSENT') {
    return { skipped: true, reason: 'not a new/changed absence' };
  }

  const { student_id, school_id, class_id } = detail;

  const recordsRes = await doc.send(new QueryCommand({
    TableName: ATTENDANCE_TABLE,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    FilterExpression: 'class_id = :cid',
    ExpressionAttributeValues: {
      ':sid': student_id,
      ':cid': class_id,
    },
  }));

  const records = recordsRes.Items || [];
  const total = records.length;
  if (total < MIN_RECORDS) {
    return { triggered: false, reason: `only ${total} marked days, need ${MIN_RECORDS}` };
  }

  const present = records.filter((r) => r.status !== 'ABSENT').length;
  const rate = present / total;

  let stage = null;
  if (rate < EXAM_ELIGIBILITY_RATE) stage = 'INELIGIBLE';
  else if (rate < WARNING_RATE) stage = 'WARNING';

  if (!stage) {
    return { triggered: false };
  }

  // One text per stage per student. Failed sends don't count, so the next
  // absence retries them.
  const sentRes = await doc.send(new QueryCommand({
    TableName: NOTIFICATION_TABLE,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    FilterExpression: 'alert_type = :stage AND #s = :sent',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':sid': student_id,
      ':stage': stage,
      ':sent': 'SENT',
    },
  }));

  if ((sentRes.Items || []).length > 0) {
    return { triggered: true, stage, skipped: 'parent already notified at this stage' };
  }

  const studentRes = await doc.send(new GetCommand({
    TableName: STUDENT_TABLE,
    Key: { id: student_id },
  }));
  const student = studentRes.Item;

  if (!student?.guardian_phone) {
    console.error(`No guardian_phone on file for student ${student_id}, cannot send alert`);
    return { triggered: true, stage, skipped: 'no guardian phone on file' };
  }

  await lambdaClient.send(new InvokeCommand({
    FunctionName: SEND_SMS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify({
      school_id,
      student_id,
      guardian_phone: student.guardian_phone,
      message: buildMessage(stage, student, rate),
      alert_type: stage,
    }),
  }));

  return { triggered: true, stage, rate };
};

exports.buildMessage = buildMessage;

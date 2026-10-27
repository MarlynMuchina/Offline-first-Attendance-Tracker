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
//
// A guardian can also choose to hear about every absence (sms_preference
// EVERY_ABSENCE on the student). They then get one ABSENCE text per absent
// day on top of the two stage texts. On a day that crosses a stage, only the
// stage text goes out, since it already says the student was absent enough
// to matter.
const WARNING_RATE = 0.70;
const EXAM_ELIGIBILITY_RATE = 2 / 3;
const MIN_RECORDS = 10;
const EVERY_ABSENCE = 'EVERY_ABSENCE';

function formatPercent(rate) {
  return `${Math.floor(rate * 100)}%`;
}

// Guardians choose English (default) or Kiswahili on the student as
// sms_language: EN | SW. Every text stays within one 160-character SMS.
function buildMessage(stage, student, rate, date) {
  const name = `${student.first_name} ${student.last_name}`;
  if (student.sms_language === 'SW') {
    if (stage === 'ABSENCE') {
      return `CSG: ${name} hakufika shuleni tarehe ${date}. Tafadhali wasiliana na shule ukiwa na swali lolote.`;
    }
    if (stage === 'INELIGIBLE') {
      return `CSG: Mahudhurio ya ${name} ni ${formatPercent(rate)}, chini ya kiwango cha 67%. Kwa sasa haruhusiwi kufanya mitihani. Tafadhali wasiliana na shule.`;
    }
    return `CSG: Mahudhurio ya ${name} ni ${formatPercent(rate)}, chini ya 70%. Chini ya 67% hataruhusiwa kufanya mitihani. Tafadhali wasiliana na shule.`;
  }
  if (stage === 'ABSENCE') {
    return `CSG: ${name} was marked absent on ${date}. Please contact the school if you have any questions.`;
  }
  if (stage === 'INELIGIBLE') {
    return `CSG: ${name}'s attendance is ${formatPercent(rate)}, below the 67% minimum. They are not currently eligible to sit exams. Please contact the school.`;
  }
  return `CSG: ${name}'s attendance is ${formatPercent(rate)}, below 70%. Below 67% they will not be eligible to sit exams. Please contact the school.`;
}

// True when a SENT text of this type already exists for the student (and,
// for ABSENCE texts, for this date). Failed sends don't count, so the next
// absence retries them.
async function alreadySent(student_id, alertType, date) {
  const filter = ['alert_type = :type', '#s = :sent'];
  const values = { ':sid': student_id, ':type': alertType, ':sent': 'SENT' };
  if (date) {
    filter.push('alert_date = :date');
    values[':date'] = date;
  }
  const res = await doc.send(new QueryCommand({
    TableName: NOTIFICATION_TABLE,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    FilterExpression: filter.join(' AND '),
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: values,
  }));
  return (res.Items || []).length > 0;
}

async function sendText({ school_id, student, alertType, rate, date }) {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: SEND_SMS_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify({
      school_id,
      student_id: student.id,
      guardian_phone: student.guardian_phone,
      message: buildMessage(alertType, student, rate, date),
      alert_type: alertType,
      ...(alertType === 'ABSENCE' && { alert_date: date }),
    }),
  }));
}

exports.handler = async (event) => {
  const detail = event.detail;

  if (!['CREATED', 'UPDATED'].includes(detail.action) || detail.status !== 'ABSENT') {
    return { skipped: true, reason: 'not a new/changed absence' };
  }

  const { student_id, school_id, class_id, date } = detail;

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
  const present = records.filter((r) => r.status !== 'ABSENT').length;
  const rate = total > 0 ? present / total : 0;

  const studentRes = await doc.send(new GetCommand({
    TableName: STUDENT_TABLE,
    Key: { id: student_id },
  }));
  const student = { id: student_id, ...studentRes.Item };
  const everyAbsence = student.sms_preference === EVERY_ABSENCE;

  let stage = null;
  if (total >= MIN_RECORDS) {
    if (rate < EXAM_ELIGIBILITY_RATE) stage = 'INELIGIBLE';
    else if (rate < WARNING_RATE) stage = 'WARNING';
  }

  if (!stage && !everyAbsence) {
    return total < MIN_RECORDS
      ? { triggered: false, reason: `only ${total} marked days, need ${MIN_RECORDS}` }
      : { triggered: false };
  }

  if (!student.guardian_phone) {
    console.error(`No guardian_phone on file for student ${student_id}, cannot send alert`);
    return { triggered: true, stage, skipped: 'no guardian phone on file' };
  }

  if (stage && !(await alreadySent(student_id, stage))) {
    await sendText({ school_id, student, alertType: stage, rate });
    return { triggered: true, stage, rate };
  }

  if (!everyAbsence) {
    return { triggered: true, stage, skipped: 'parent already notified at this stage' };
  }

  if (await alreadySent(student_id, 'ABSENCE', date)) {
    return { triggered: true, stage: 'ABSENCE', skipped: 'parent already told about this absence' };
  }
  await sendText({ school_id, student, alertType: 'ABSENCE', rate, date });
  return { triggered: true, stage: 'ABSENCE', rate };
};

exports.buildMessage = buildMessage;

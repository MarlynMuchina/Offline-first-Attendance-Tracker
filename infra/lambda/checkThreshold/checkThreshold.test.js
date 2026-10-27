/**
 * checkThreshold.test.js
 *
 * Covers the two-stage parent alert rules:
 *  - no text until the student has MIN_RECORDS marked days
 *  - WARNING below 70%, INELIGIBLE below 2/3
 *  - at most one SENT text per stage per student
 *  - a big drop straight past 2/3 sends only the INELIGIBLE text
 *  - guardians who chose EVERY_ABSENCE get one text per absent day
 *
 * Run: npx jest checkThreshold.test.js
 */

const mockDocSend = jest.fn();
const mockLambdaSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', ...params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', ...params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', ...params })),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn((params) => params),
}));

process.env.ATTENDANCE_TABLE = 'Attendance-test';
process.env.NOTIFICATION_TABLE = 'NotificationLog-test';
process.env.STUDENT_TABLE = 'Student-test';
process.env.SEND_SMS_FUNCTION_NAME = 'sendSmsFunction';

const { handler, buildMessage } = require('./index');

const EVENT = {
  detail: { action: 'CREATED', status: 'ABSENT', student_id: 'S1', school_id: 'SCH01', class_id: 'C1', date: '2026-10-14' },
};

const STUDENT = { id: 'S1', first_name: 'Test', last_name: 'Airtel', guardian_phone: '+254750571345' };
const EVERY_ABSENCE_STUDENT = { ...STUDENT, sms_preference: 'EVERY_ABSENCE' };

function records(present, absent) {
  return [
    ...Array.from({ length: present }, () => ({ status: 'PRESENT', class_id: 'C1' })),
    ...Array.from({ length: absent }, () => ({ status: 'ABSENT', class_id: 'C1' })),
  ];
}

// Routes each DynamoDB call to the right fake table. sentAlerts entries are
// a stage name, or { type: 'ABSENCE', date } for a per-absence text.
function mockTables({ attendance, sentAlerts = [], student = STUDENT }) {
  mockDocSend.mockImplementation(async (cmd) => {
    if (cmd.type === 'Get') return { Item: student };
    if (cmd.TableName === 'Attendance-test') return { Items: attendance };
    if (cmd.TableName === 'NotificationLog-test') {
      const type = cmd.ExpressionAttributeValues[':type'];
      const date = cmd.ExpressionAttributeValues[':date'];
      const matches = sentAlerts
        .map((a) => (typeof a === 'string' ? { type: a } : a))
        .filter((a) => a.type === type && (!date || a.date === date));
      return { Items: matches.map((a) => ({ alert_type: a.type, alert_date: a.date, status: 'SENT' })) };
    }
    throw new Error(`unexpected command ${JSON.stringify(cmd)}`);
  });
}

function sentPayload() {
  return JSON.parse(mockLambdaSend.mock.calls[0][0].Payload);
}

beforeEach(() => {
  mockDocSend.mockReset();
  mockLambdaSend.mockReset();
});

test('ignores events that are not absences', async () => {
  const result = await handler({ detail: { ...EVENT.detail, status: 'PRESENT' } });
  expect(result.skipped).toBe(true);
  expect(mockDocSend).not.toHaveBeenCalled();
});

test('a new student\'s first absence does not text the parent', async () => {
  mockTables({ attendance: records(0, 1) });
  const result = await handler(EVENT);
  expect(result.triggered).toBe(false);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('no text while attendance is at or above 70%', async () => {
  mockTables({ attendance: records(7, 3) });
  const result = await handler(EVENT);
  expect(result.triggered).toBe(false);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('sends the WARNING text once attendance drops below 70%', async () => {
  mockTables({ attendance: records(13, 6) }); // 68%
  const result = await handler(EVENT);
  expect(result.stage).toBe('WARNING');
  const payload = sentPayload();
  expect(payload.alert_type).toBe('WARNING');
  expect(payload.guardian_phone).toBe('+254750571345');
  expect(payload.message).toContain('below 70%');
});

test('does not repeat the WARNING text once it has been sent', async () => {
  mockTables({ attendance: records(13, 6), sentAlerts: ['WARNING'] });
  const result = await handler(EVENT);
  expect(result.skipped).toMatch(/already notified/);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('sends the INELIGIBLE text below 2/3 even after a WARNING was sent', async () => {
  mockTables({ attendance: records(6, 4), sentAlerts: ['WARNING'] }); // 60%
  const result = await handler(EVENT);
  expect(result.stage).toBe('INELIGIBLE');
  expect(sentPayload().message).toContain('not currently eligible to sit exams');
});

test('exactly 2/3 is still eligible, so it is a WARNING', async () => {
  mockTables({ attendance: records(10, 5) });
  const result = await handler(EVENT);
  expect(result.stage).toBe('WARNING');
});

test('a drop straight past 2/3 sends only the INELIGIBLE text', async () => {
  mockTables({ attendance: records(5, 5) });
  await handler(EVENT);
  expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  expect(sentPayload().alert_type).toBe('INELIGIBLE');
});

test('skips the text when the student has no guardian phone', async () => {
  mockTables({ attendance: records(5, 5), student: { ...STUDENT, guardian_phone: null } });
  const result = await handler(EVENT);
  expect(result.skipped).toMatch(/no guardian phone/);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('messages fit in a single SMS for typical names', () => {
  const longName = { first_name: 'Christabel', last_name: 'Wanjiku-Mwangi' };
  expect(buildMessage('WARNING', longName, 0.69).length).toBeLessThanOrEqual(160);
  expect(buildMessage('INELIGIBLE', longName, 0.6).length).toBeLessThanOrEqual(160);
});

test('the percentage is rounded down so 66.5% never reads as 67%', () => {
  expect(buildMessage('INELIGIBLE', STUDENT, 0.665)).toContain('66%');
});

test('a guardian who chose every absence is texted on a new student\'s first absence', async () => {
  mockTables({ attendance: records(0, 1), student: EVERY_ABSENCE_STUDENT });
  const result = await handler(EVENT);
  expect(result.stage).toBe('ABSENCE');
  const payload = sentPayload();
  expect(payload.alert_type).toBe('ABSENCE');
  expect(payload.alert_date).toBe('2026-10-14');
  expect(payload.message).toContain('marked absent on 2026-10-14');
});

test('every-absence guardians are texted once per absent day', async () => {
  mockTables({
    attendance: records(9, 1),
    student: EVERY_ABSENCE_STUDENT,
    sentAlerts: [{ type: 'ABSENCE', date: '2026-10-14' }],
  });
  const result = await handler(EVENT);
  expect(result.skipped).toMatch(/already told/);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('on the day a stage is crossed, every-absence guardians get only the stage text', async () => {
  mockTables({ attendance: records(13, 6), student: EVERY_ABSENCE_STUDENT });
  await handler(EVENT);
  expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  expect(sentPayload().alert_type).toBe('WARNING');
});

test('after the stage text, every-absence guardians still hear about later absences', async () => {
  mockTables({ attendance: records(15, 7), student: EVERY_ABSENCE_STUDENT, sentAlerts: ['WARNING'] });
  const result = await handler(EVENT);
  expect(result.stage).toBe('ABSENCE');
  expect(sentPayload().alert_type).toBe('ABSENCE');
});

test('threshold-only guardians are not texted for an ordinary absence', async () => {
  mockTables({ attendance: records(12, 1) });
  await handler(EVENT);
  expect(mockLambdaSend).not.toHaveBeenCalled();
});

test('the absence text fits in a single SMS', () => {
  const longName = { first_name: 'Christabel', last_name: 'Wanjiku-Mwangi' };
  expect(buildMessage('ABSENCE', longName, 0, '2026-10-14').length).toBeLessThanOrEqual(160);
});

test('Kiswahili guardians get every text in Kiswahili, each in a single SMS', () => {
  const longName = { first_name: 'Christabel', last_name: 'Wanjiku-Mwangi', sms_language: 'SW' };
  const absence = buildMessage('ABSENCE', longName, 0, '2026-10-14');
  const warning = buildMessage('WARNING', longName, 0.69);
  const ineligible = buildMessage('INELIGIBLE', longName, 0.6);
  expect(absence).toContain('hakufika shuleni tarehe 2026-10-14');
  expect(warning).toContain('Mahudhurio ya Christabel Wanjiku-Mwangi ni 69%');
  expect(ineligible).toContain('haruhusiwi kufanya mitihani');
  for (const text of [absence, warning, ineligible]) expect(text.length).toBeLessThanOrEqual(160);
});

test('a student with no language set gets English', () => {
  expect(buildMessage('WARNING', STUDENT, 0.69)).toContain('below 70%');
});

test('the warning goes out in the language the guardian chose', async () => {
  mockTables({ attendance: records(13, 6), student: { ...STUDENT, sms_language: 'SW' } });
  await handler(EVENT);
  expect(sentPayload().message).toContain('Mahudhurio ya Test Airtel');
});

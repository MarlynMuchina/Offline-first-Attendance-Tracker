/**
 * exportAttendanceData.test.js
 *
 * Covers the daily export: every pilot school is read through the bySchool
 * index (following pages), names are joined in, CSV values are escaped, and
 * one file per day is written to the export bucket.
 *
 * Run: npx jest exportAttendanceData.test.js
 */

const mockDocSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  QueryCommand: jest.fn((params) => ({ __type: 'QueryCommand', ...params })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ __type: 'PutObjectCommand', ...params })),
}));

process.env.ATTENDANCE_TABLE = 'AttendanceRecord-test';
process.env.STUDENT_TABLE = 'Student-test';
process.env.CLASS_TABLE = 'Class-test';
process.env.EXPORT_BUCKET = 'csg-attendance-exports-test';
process.env.SCHOOL_IDS = 'SCH01, SCH02';

const { handler } = require('./index');

const DATA = {
  'Student-test': {
    SCH01: [{ id: 'S1', first_name: 'Amina', last_name: 'Otieno' }],
    SCH02: [{ id: 'S2', first_name: 'Brian', last_name: 'Kiptoo' }],
  },
  'Class-test': {
    SCH01: [{ id: 'C1', name: 'Form 2 North' }],
    SCH02: [{ id: 'C2', name: 'Form 3, "Mars"' }],
  },
  'AttendanceRecord-test': {
    SCH01: [{ date: '2026-06-01', school_id: 'SCH01', class_id: 'C1', student_id: 'S1', status: 'PRESENT', marked_by: 't1', marked_at: '2026-06-01T07:00:00Z' }],
    SCH02: [
      { date: '2026-06-01', school_id: 'SCH02', class_id: 'C2', student_id: 'S2', status: 'ABSENT', marked_by: 't2', marked_at: '2026-06-01T07:05:00Z' },
      { date: '2026-06-02', school_id: 'SCH02', class_id: 'C9', student_id: 'S9', status: 'LATE', marked_by: 't2', marked_at: '2026-06-02T07:05:00Z' },
    ],
  },
};

beforeEach(() => {
  mockDocSend.mockReset();
  mockS3Send.mockReset().mockResolvedValue({});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // SCH02 attendance comes back over two pages; everything else in one
  mockDocSend.mockImplementation(async ({ TableName, ExpressionAttributeValues, ExclusiveStartKey }) => {
    const items = DATA[TableName][ExpressionAttributeValues[':sid']];
    if (TableName === 'AttendanceRecord-test' && ExpressionAttributeValues[':sid'] === 'SCH02') {
      return ExclusiveStartKey ? { Items: items.slice(1) } : { Items: items.slice(0, 1), LastEvaluatedKey: { k: 1 } };
    }
    return { Items: items };
  });
});

test('reads every school through the bySchool index, following pages', async () => {
  await handler();

  const queries = mockDocSend.mock.calls.map(([c]) => c);
  expect(queries.every((q) => q.IndexName === 'bySchool')).toBe(true);
  expect(queries.filter((q) => q.TableName === 'AttendanceRecord-test')).toHaveLength(3);
  expect(new Set(queries.map((q) => q.ExpressionAttributeValues[':sid']))).toEqual(new Set(['SCH01', 'SCH02']));
});

test('writes one CSV for all schools with names joined in', async () => {
  const result = await handler();

  const put = mockS3Send.mock.calls[0][0];
  const today = new Date().toISOString().split('T')[0];
  expect(put).toMatchObject({
    Bucket: 'csg-attendance-exports-test',
    Key: `exports/attendance/all-schools/${today}.csv`,
    ContentType: 'text/csv',
  });
  const lines = put.Body.split('\n');
  expect(lines[0]).toBe('date,school_id,class_id,class_name,student_id,student_name,status,marked_by,marked_at');
  expect(lines).toContain('2026-06-01,SCH01,C1,Form 2 North,S1,Amina Otieno,PRESENT,t1,2026-06-01T07:00:00Z');
  expect(result).toEqual({ exportedCount: 3, key: put.Key });
});

test('quotes values with commas or quotes, and marks unknown names', async () => {
  await handler();

  const body = mockS3Send.mock.calls[0][0].Body;
  expect(body).toContain('SCH02,C2,"Form 3, ""Mars""",S2,Brian Kiptoo,ABSENT');
  expect(body).toContain('SCH02,C9,UNKNOWN,S9,UNKNOWN,LATE');
});

test('copes with an empty table', async () => {
  mockDocSend.mockReset().mockResolvedValue({});

  const result = await handler();

  expect(result.exportedCount).toBe(0);
  expect(mockS3Send.mock.calls[0][0].Body.split('\n')).toHaveLength(1);
});

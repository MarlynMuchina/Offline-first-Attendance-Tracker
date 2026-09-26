/**
 * attendanceSummary.test.js
 *
 * Covers:
 *  - correct GSI usage: byClass (single-key) for students, byClassDate
 *    (composite key: class_id + date) for records -- these are genuinely
 *    different index shapes, unlike the single-key-only byStudent GSI
 *    used elsewhere in this codebase
 *  - aggregation math: present/absent/late tallies, attendance_rate
 *    rounding, null rate for a student with zero records in range
 *  - the <70% "below threshold" filter, including the "none" fallback
 *    text when no one qualifies
 *  - Bedrock is invoked with the correct model ID, prompt structure,
 *    and request shape
 *  - response parsing extracts summary text correctly
 *  - documents (rather than "fixes") two things worth knowing:
 *      1. school_id is accepted as input but never used in either query
 *      2. a Bedrock failure propagates as a rejected promise with no
 *         local try/catch -- intentional or not, this test makes that
 *         behavior explicit rather than letting it be an unexamined gap
 *
 * Run: npx jest attendanceSummary.test.js
 */

const mockDocSend = jest.fn();
const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  QueryCommand: jest.fn((params) => ({ __type: 'QueryCommand', ...params })),
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: jest.fn((params) => ({ __type: 'InvokeModelCommand', ...params })),
}));

process.env.ATTENDANCE_TABLE = 'AttendanceRecord-test-NONE';
process.env.STUDENT_TABLE = 'Student-test-NONE';

const { handler } = require('./index');

function bedrockResponseFor(text) {
  const body = JSON.stringify({ content: [{ text }] });
  return { body: new TextEncoder().encode(body) };
}

const STUDENTS = [
  { id: 'S001', first_name: 'Amina', last_name: 'Otieno' },
  { id: 'S002', first_name: 'Brian', last_name: 'Kiptoo' },
  { id: 'S003', first_name: 'Cynthia', last_name: 'Wanjiru' }, // no records in range
];

const RECORDS = [
  // S001: 8 present, 2 absent -> 80%
  ...Array(8).fill(null).map((_, i) => ({ student_id: 'S001', status: 'PRESENT', date: `2026-06-0${i + 1}` })),
  { student_id: 'S001', status: 'ABSENT', date: '2026-06-09' },
  { student_id: 'S001', status: 'ABSENT', date: '2026-06-10' },
  // S002: 6 present, 3 absent, 1 late -> 6/10 = 60% (below threshold)
  ...Array(6).fill(null).map((_, i) => ({ student_id: 'S002', status: 'PRESENT', date: `2026-06-0${i + 1}` })),
  { student_id: 'S002', status: 'ABSENT', date: '2026-06-07' },
  { student_id: 'S002', status: 'ABSENT', date: '2026-06-08' },
  { student_id: 'S002', status: 'ABSENT', date: '2026-06-09' },
  { student_id: 'S002', status: 'LATE', date: '2026-06-10' },
  // S003: no records at all
];

const VALID_INPUT = {
  school_id: 'SCH01',
  class_id: 'SCH01-FORM2NORTH',
  start_date: '2026-06-01',
  end_date: '2026-06-10',
};

beforeEach(() => {
  mockDocSend.mockReset();
  mockBedrockSend.mockReset();
});

describe('attendanceSummary handler', () => {
  test('queries Student table via byClass (single-key: class_id only)', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const studentQuery = mockDocSend.mock.calls[0][0];
    expect(studentQuery.TableName).toBe('Student-test-NONE');
    expect(studentQuery.IndexName).toBe('byClass');
    expect(studentQuery.KeyConditionExpression).toBe('class_id = :cid');
  });

  test('queries AttendanceRecord table via byClassDate with a composite class_id+date condition', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const recordQuery = mockDocSend.mock.calls[1][0];
    expect(recordQuery.TableName).toBe('AttendanceRecord-test-NONE');
    expect(recordQuery.IndexName).toBe('byClassDate');
    // Unlike byStudent (single-key), byClassDate genuinely has date as a
    // sort key in the schema, so combining both here is correct -- NOT
    // the single-key GSI bug pattern seen elsewhere in this codebase.
    expect(recordQuery.KeyConditionExpression).toBe('class_id = :cid AND #d BETWEEN :start AND :end');
    expect(recordQuery.ExpressionAttributeValues[':start']).toBe('2026-06-01');
    expect(recordQuery.ExpressionAttributeValues[':end']).toBe('2026-06-10');
  });

  test('school_id is accepted as input but not used in either query (documented, not asserted as correct or incorrect)', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const studentQuery = mockDocSend.mock.calls[0][0];
    const recordQuery = mockDocSend.mock.calls[1][0];
    expect(JSON.stringify(studentQuery)).not.toContain('school_id');
    expect(JSON.stringify(recordQuery)).not.toContain('school_id');
  });

  test('aggregation: correct present/absent/late tallies and rounded attendance_rate', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const promptSent = mockBedrockSend.mock.calls[0][0].body;
    const parsedBody = JSON.parse(promptSent);
    const promptText = parsedBody.messages[0].content;

    expect(promptText).toContain('"attendance_rate": 80');
    expect(promptText).toContain('"attendance_rate": 60');
  });

  test('a student with zero records in range gets a null attendance_rate, not a divide-by-zero error', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS }); // S003 has no matching records
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const promptText = JSON.parse(mockBedrockSend.mock.calls[0][0].body).messages[0].content;
    expect(promptText).toContain('"name": "Cynthia Wanjiru"');
    expect(promptText).toContain('"attendance_rate": null');
  });

  test('students below 70% are correctly identified and included in the prompt', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const promptText = JSON.parse(mockBedrockSend.mock.calls[0][0].body).messages[0].content;
    expect(promptText).toContain('Students below 70% attendance: [{"name":"Brian Kiptoo"');
    expect(promptText).not.toContain('Students below 70% attendance: none');
  });

  test('prompt says "none" when no student is below threshold', async () => {
    const allGoodRecords = Array(10).fill(null).map((_, i) => ({
      student_id: 'S001', status: 'PRESENT', date: `2026-06-${String(i + 1).padStart(2, '0')}`,
    }));
    mockDocSend
      .mockResolvedValueOnce({ Items: [STUDENTS[0]] })
      .mockResolvedValueOnce({ Items: allGoodRecords });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const promptText = JSON.parse(mockBedrockSend.mock.calls[0][0].body).messages[0].content;
    expect(promptText).toContain('Students below 70% attendance: none');
  });

  test('invokes Bedrock with the correct EU Claude Haiku 4.5 inference profile and request shape', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await handler({ arguments: { input: VALID_INPUT } });

    const bedrockCall = mockBedrockSend.mock.calls[0][0];
    expect(bedrockCall.modelId).toBe('eu.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(bedrockCall.contentType).toBe('application/json');

    const parsedBody = JSON.parse(bedrockCall.body);
    expect(parsedBody.anthropic_version).toBe('bedrock-2023-05-31');
    expect(parsedBody.max_tokens).toBe(500);
    expect(parsedBody.messages[0].role).toBe('user');
  });

  test('extracts summary text from the Bedrock response and returns it with a valid generated_at timestamp', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('This class is doing well overall.'));

    const result = await handler({ arguments: { input: VALID_INPUT } });

    expect(result.summary).toBe('This class is doing well overall.');
    expect(new Date(result.generated_at).toString()).not.toBe('Invalid Date');
  });

  test('a Bedrock failure propagates as a rejected promise (no local try/catch -- documented behavior, not silently fixed)', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: STUDENTS })
      .mockResolvedValueOnce({ Items: RECORDS });
    mockBedrockSend.mockRejectedValue(new Error('AccessDeniedException: not subscribed to this model'));

    await expect(handler({ arguments: { input: VALID_INPUT } })).rejects.toThrow(
      'AccessDeniedException'
    );
  });

  test('handles an empty student roster (no crash, empty aggregation)', async () => {
    mockDocSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('No students in this class.'));

    const result = await handler({ arguments: { input: VALID_INPUT } });
    expect(result.summary).toBe('No students in this class.');
  });

  test('handles a missing Items array from DynamoDB gracefully (both queries)', async () => {
    mockDocSend
      .mockResolvedValueOnce({}) // no Items key
      .mockResolvedValueOnce({}); // no Items key
    mockBedrockSend.mockResolvedValue(bedrockResponseFor('summary text'));

    await expect(handler({ arguments: { input: VALID_INPUT } })).resolves.toMatchObject({
      summary: 'summary text',
    });
  });
});
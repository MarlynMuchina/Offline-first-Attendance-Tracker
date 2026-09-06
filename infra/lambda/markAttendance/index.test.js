const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

process.env.TABLE_NAME = 'test-table';

const { handler } = require('./index');

function baseInput(overrides = {}) {
  return {
    school_id: 'school-001',
    student_id: 'student-001',
    class_id: 'class-form2east',
    date: '2026-09-05',
    status: 'PRESENT',
    marked_by: 'teacher-001',
    marked_at: '2026-09-05T10:00:00.000Z',
    client_request_id: 'req-001',
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ebMock.on(PutEventsCommand).resolves({});
});

describe('markAttendance handler', () => {
  test('rejects an invalid status', async () => {
    const event = { arguments: { input: baseInput({ status: 'BOGUS' }) } };
    await expect(handler(event)).rejects.toThrow(/Invalid status/);
  });

  test('rejects missing required fields', async () => {
    const event = { arguments: { input: baseInput({ school_id: '' }) } };
    await expect(handler(event)).rejects.toThrow(/Missing required field/);
  });

  test('creates a new record when none exists', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const event = { arguments: { input: baseInput() } };
    const result = await handler(event);

    expect(result.status).toBe('PRESENT');
    expect(result.student_id).toBe('student-001');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
  });

  test('returns existing record unchanged on idempotent replay', async () => {
    const existing = {
      id: 'existing-id',
      student_id: 'student-001',
      status: 'PRESENT',
      marked_at: '2026-09-05T10:00:00.000Z',
      client_request_id: 'req-001',
    };
    ddbMock.on(QueryCommand).resolves({ Items: [existing] });

    const event = { arguments: { input: baseInput({ client_request_id: 'req-001' }) } };
    const result = await handler(event);

    expect(result.id).toBe('existing-id');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('rejects a stale write older than the existing record', async () => {
    const existing = {
      id: 'existing-id',
      student_id: 'student-001',
      status: 'PRESENT',
      marked_at: '2026-09-05T12:00:00.000Z',
      client_request_id: 'req-different',
    };
    ddbMock.on(QueryCommand).resolves({ Items: [existing] });

    const staleInput = baseInput({ marked_at: '2026-09-05T09:00:00.000Z', client_request_id: 'req-002' });
    const event = { arguments: { input: staleInput } };
    const result = await handler(event);

    expect(result.status).toBe('PRESENT');
    expect(result.id).toBe('existing-id');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('updates an existing record with a newer write', async () => {
    const existing = {
      id: 'existing-id',
      student_id: 'student-001',
      status: 'ABSENT',
      marked_at: '2026-09-05T08:00:00.000Z',
      client_request_id: 'req-different',
    };
    ddbMock.on(QueryCommand).resolves({ Items: [existing] });
    ddbMock.on(UpdateCommand).resolves({});

    const newerInput = baseInput({ status: 'LATE', marked_at: '2026-09-05T11:00:00.000Z' });
    const event = { arguments: { input: newerInput } };
    const result = await handler(event);

    expect(result.status).toBe('LATE');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});
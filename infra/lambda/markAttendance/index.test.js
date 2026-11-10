const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

process.env.TABLE_NAME = 'test-table';
process.env.STUDENT_TABLE = 'student-table';

const CALLER = { claims: { 'custom:school_id': 'school-001' } };

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
  cognitoMock.reset();
  ebMock.on(PutEventsCommand).resolves({});
  ddbMock.on(GetCommand).resolves({ Item: { id: 'student-001', school_id: 'school-001' } });
});

describe('markAttendance handler', () => {
  test('rejects an invalid status', async () => {
    const event = { identity: CALLER, arguments: { input: baseInput({ status: 'BOGUS' }) } };
    await expect(handler(event)).rejects.toThrow(/Invalid status/);
  });

  test('rejects missing required fields', async () => {
    const event = { identity: CALLER, arguments: { input: baseInput({ school_id: '' }) } };
    await expect(handler(event)).rejects.toThrow(/Missing required field/);
  });

  test('creates a new record when none exists', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const event = { identity: CALLER, arguments: { input: baseInput() } };
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

    const event = { identity: CALLER, arguments: { input: baseInput({ client_request_id: 'req-001' }) } };
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
    const event = { identity: CALLER, arguments: { input: staleInput } };
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
    const event = { identity: CALLER, arguments: { input: newerInput } };
    const result = await handler(event);

    expect(result.status).toBe('LATE');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });
});

describe('school checks', () => {
  test('refuses a caller from another school', async () => {
    const event = { identity: { claims: { 'custom:school_id': 'school-002' } }, arguments: { input: baseInput() } };
    await expect(handler(event)).rejects.toThrow("You can only work with your own school's data.");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test("refuses a student from another school, even with the caller's own school_id", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { id: 'student-001', school_id: 'school-002' } });
    const event = { identity: CALLER, arguments: { input: baseInput() } };
    await expect(handler(event)).rejects.toThrow('This student is not in your school.');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('refuses a student that does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const event = { identity: CALLER, arguments: { input: baseInput() } };
    await expect(handler(event)).rejects.toThrow('This student is not in your school.');
  });

  test("looks the caller's school up in Cognito once, when the token doesn't carry it", async () => {
    cognitoMock.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'custom:school_id', Value: 'school-001' }] });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});
    const event = { identity: { username: 'teacher-cache-test' }, arguments: { input: baseInput() } };

    await handler(event);
    await handler(event);

    expect(cognitoMock.commandCalls(AdminGetUserCommand)).toHaveLength(1);
  });

  test('refuses a call with no signed-in user', async () => {
    await expect(handler({ arguments: { input: baseInput() } })).rejects.toThrow('Not signed in.');
  });
});

describe('absence and late reasons', () => {
  test('stores a reason that fits the status', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const event = { identity: CALLER, arguments: { input: baseInput({ status: 'ABSENT', reason_code: 'SICK' }) } };
    await handler(event);

    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item.reason_code).toBe('SICK');
  });

  test('leaves out a reason that does not fit the status', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const event = { identity: CALLER, arguments: { input: baseInput({ status: 'LATE', reason_code: 'FEES' }) } };
    await handler(event);

    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).not.toHaveProperty('reason_code');
  });

  test('a newer mark without a reason clears the old one', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ id: 'existing-id', student_id: 'student-001', status: 'ABSENT', reason_code: 'SICK',
        marked_at: '2026-09-05T08:00:00.000Z', client_request_id: 'req-different' }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const event = { identity: CALLER, arguments: { input: baseInput({ status: 'PRESENT', marked_at: '2026-09-05T11:00:00.000Z' }) } };
    await handler(event);

    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.UpdateExpression).toMatch(/REMOVE reason_code/);
  });

  test('a newer mark with a reason sets it', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ id: 'existing-id', student_id: 'student-001', status: 'ABSENT',
        marked_at: '2026-09-05T08:00:00.000Z', client_request_id: 'req-different' }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const event = { identity: CALLER, arguments: { input: baseInput({ status: 'ABSENT', reason_code: 'FEES', marked_at: '2026-09-05T11:00:00.000Z' }) } };
    await handler(event);

    const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(update.UpdateExpression).toMatch(/reason_code = :reason/);
    expect(update.ExpressionAttributeValues[':reason']).toBe('FEES');
  });
});

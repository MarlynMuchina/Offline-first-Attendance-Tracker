const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);
const eventBridge = new EventBridgeClient({});
const cognito = new CognitoIdentityProviderClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const STUDENT_TABLE = process.env.STUDENT_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID;
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE'];

// AppSync signs calls with the access token, which carries the groups but
// not custom:school_id, so the caller's school is read from Cognito. It
// never changes, so it's kept while the Lambda stays warm. The school in a
// request is never trusted on its own (CSG Vol 2, sec 2.5).
const callerSchools = new Map();

async function getCallerSchool(identity) {
  const fromToken = identity?.claims?.['custom:school_id'];
  if (fromToken) return fromToken;
  const username = identity?.username;
  if (!username) throw new Error('Not signed in.');
  if (!callerSchools.has(username)) {
    const lookup = cognito
      .send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
      .then((user) => (user.UserAttributes || []).find((a) => a.Name === 'custom:school_id')?.Value || null);
    callerSchools.set(username, lookup);
    lookup.catch(() => callerSchools.delete(username));
  }
  const schoolId = await callerSchools.get(username);
  if (!schoolId) throw new Error('This account has no school.');
  return schoolId;
}

async function assertCallerSchool(identity, schoolId) {
  if ((await getCallerSchool(identity)) !== schoolId) {
    throw new Error("You can only work with your own school's data.");
  }
}

async function emitAuditEvent(action, input, recordId) {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'csg.attendance',
        DetailType: 'AttendanceRecorded',
        Detail: JSON.stringify({
          action,
          id: recordId,
          school_id: input.school_id,
          student_id: input.student_id,
          class_id: input.class_id,
          date: input.date,
          status: input.status,
          marked_by: input.marked_by,
          marked_at: input.marked_at,
          client_request_id: input.client_request_id,
        }),
      }],
    }));
  } catch (err) {
    // Audit logging must never break the actual write path -- log and move on.
    console.error('Failed to emit audit event:', err);
  }
}

exports.handler = async (event) => {
  const input = event.arguments.input;

  // Business validation
  if (!VALID_STATUSES.includes(input.status)) {
    throw new Error(`Invalid status "${input.status}". Must be one of ${VALID_STATUSES.join(', ')}`);
  }
  if (!input.school_id || !input.student_id || !input.class_id || !input.date) {
    throw new Error('Missing required field: school_id, student_id, class_id, and date are all required');
  }

  // The caller must belong to the school, and so must the student, or a
  // record could be filed under one school for another school's student.
  await assertCallerSchool(event.identity, input.school_id);
  const student = await doc.send(new GetCommand({ TableName: STUDENT_TABLE, Key: { id: input.student_id } }));
  if (student.Item?.school_id !== input.school_id) {
    throw new Error('This student is not in your school.');
  }

  // Look up an existing record for this student/class/date (the natural key)
  const existing = await doc.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    FilterExpression: 'class_id = :cid AND #d = :date',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: {
      ':sid': input.student_id,
      ':cid': input.class_id,
      ':date': input.date,
    },
  }));

  const existingRecord = existing.Items && existing.Items[0];

  // Idempotency: if this exact client_request_id already produced this result, return it as-is
  if (existingRecord && existingRecord.client_request_id === input.client_request_id) {
    await emitAuditEvent('IDEMPOTENT_REPLAY', input, existingRecord.id);
    return {
      id: existingRecord.id,
      student_id: existingRecord.student_id,
      status: existingRecord.status,
      marked_at: existingRecord.marked_at,
    };
  }

  // Last-write-wins: only apply this write if it's newer than what's already stored
  if (existingRecord && existingRecord.marked_at > input.marked_at) {
    await emitAuditEvent('STALE_WRITE_REJECTED', input, existingRecord.id);
    return {
      id: existingRecord.id,
      student_id: existingRecord.student_id,
      status: existingRecord.status,
      marked_at: existingRecord.marked_at,
    };
  }

  const now = new Date().toISOString();

  if (existingRecord) {
    await doc.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: existingRecord.id },
      UpdateExpression: 'SET #s = :status, marked_at = :marked_at, marked_by = :marked_by, client_request_id = :crid, updated_at = :updated_at REMOVE createdAt, updatedAt',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':status': input.status,
        ':marked_at': input.marked_at,
        ':marked_by': input.marked_by,
        ':crid': input.client_request_id,
        ':updated_at': now,
      },
    }));
    await emitAuditEvent('UPDATED', input, existingRecord.id);
    return { id: existingRecord.id, student_id: input.student_id, status: input.status, marked_at: input.marked_at };
  }

  const newId = crypto.randomUUID();
  await doc.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      id: newId,
      __typename: 'AttendanceRecord',
      school_id: input.school_id,
      student_id: input.student_id,
      class_id: input.class_id,
      date: input.date,
      status: input.status,
      marked_by: input.marked_by,
      marked_at: input.marked_at,
      client_request_id: input.client_request_id,
      created_at: now,
      updated_at: now,
    },
  }));
  await emitAuditEvent('CREATED', input, newId);
  return { id: newId, student_id: input.student_id, status: input.status, marked_at: input.marked_at };
};
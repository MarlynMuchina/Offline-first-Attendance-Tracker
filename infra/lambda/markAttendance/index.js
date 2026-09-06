const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);
const eventBridge = new EventBridgeClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE'];

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
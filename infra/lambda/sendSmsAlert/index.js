const crypto = require('crypto');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const secretsClient = new SecretsManagerClient({});
const ddbClient = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddbClient);
const cognito = new CognitoIdentityProviderClient({});

const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE;
const SECRET_NAME = process.env.AT_SECRET_NAME;
const STUDENT_TABLE = process.env.STUDENT_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID;

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

let cachedCredentials = null;

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  cachedCredentials = JSON.parse(secret.SecretString);
  return cachedCredentials;
}

exports.handler = async (event) => {
  const input = event.arguments?.input ?? event;
  const { school_id, student_id, guardian_phone, message, alert_type, alert_date } = input;

  // checkThreshold invokes this directly with data it read itself. Calls
  // through the API may only text the guardian on file for a student in
  // the caller's own school, so the SMS wallet can't be spent on any number.
  if (event.arguments) {
    await assertCallerSchool(event.identity, school_id);
    const student = await doc.send(new GetCommand({ TableName: STUDENT_TABLE, Key: { id: student_id } }));
    if (student.Item?.school_id !== school_id || student.Item?.guardian_phone !== guardian_phone) {
      throw new Error('Texts can only go to the guardian on file for a student in your school.');
    }
  }

  const { apiKey, username } = await getCredentials();
  const at = require('africastalking')({ apiKey, username });

  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();
  let atResult;
  let status = 'FAILED';

  try {
    atResult = await at.SMS.send({ to: [guardian_phone], message });
    const recipientStatus = atResult?.SMSMessageData?.Recipients?.[0]?.status;
    status = recipientStatus === 'Success' ? 'SENT' : 'FAILED';
    if (status === 'FAILED') {
      console.error('Africa\'s Talking did not accept the message:', JSON.stringify(atResult));
    }
  } catch (err) {
    console.error('Africa\'s Talking send failed:', err);
    status = 'FAILED';
  }

  await doc.send(new PutCommand({
    TableName: NOTIFICATION_TABLE,
    Item: {
      id: notificationId,
      __typename: 'NotificationLog',
      school_id,
      student_id,
      guardian_phone,
      message,
      channel: 'SMS',
      status,
      sent_at: now,
      created_at: now,
      ...(alert_type && { alert_type }),
      ...(alert_date && { alert_date }),
    },
  }));

  return {
    success: status === 'SENT',
    status,
    notification_id: notificationId,
  };
};
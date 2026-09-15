const crypto = require('crypto');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const secretsClient = new SecretsManagerClient({});
const ddbClient = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddbClient);

const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE;
const SECRET_NAME = process.env.AT_SECRET_NAME;

let cachedCredentials = null;

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  cachedCredentials = JSON.parse(secret.SecretString);
  return cachedCredentials;
}

exports.handler = async (event) => {
  const { school_id, student_id, guardian_phone, message } = event.arguments.input;

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
    },
  }));

  return {
    success: status === 'SENT',
    status,
    notification_id: notificationId,
  };
};
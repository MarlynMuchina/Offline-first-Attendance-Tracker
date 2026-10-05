/**
 * createTeacherAccount/index.js
 *
 * Headteacher-facing onboarding action: given a new teacher's name, phone
 * number, and (optional) email, this creates everything needed for them to
 * log in and be correctly recognized by the rest of the system in one step:
 *
 *   1. A Cognito user, with username = phone_number (required by this pool's
 *      UsernameAttributes config -- a phone number added AFTER creation
 *      never works as a sign-in identifier, a real gotcha hit earlier in
 *      this project). custom:school_id is set here too, since it's
 *      immutable after creation.
 *   2. Added to the Teacher Cognito group.
 *   3. A Teacher DynamoDB record, with cognito_sub set from the start --
 *      avoids the manual CLI linking step that was previously needed
 *      after the fact.
 *
 * Returns a temporary password so the admin/headteacher can hand it to the
 * new teacher directly (in person or by phone call) -- the teacher sets
 * their own permanent password on first login, via the
 * CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED flow already built into
 * Login.jsx. MessageAction: 'SUPPRESS' stops Cognito from trying to email
 * the temp password itself, since this flow hands it back through the
 * mutation response instead.
 *
 * Not atomic across all three steps -- if the DynamoDB write fails after
 * the Cognito user was already created, you'd have an orphaned Cognito
 * account with no Teacher record. Acceptable for this project's scale and
 * timeline; a production-hardened version would need a saga/cleanup step
 * or an idempotency check. Documented here rather than silently assumed
 * safe.
 */
const crypto = require('crypto');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const cognito = new CognitoIdentityProviderClient({});
const ddbClient = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(ddbClient);

const USER_POOL_ID = process.env.USER_POOL_ID;
const TEACHER_TABLE = process.env.TEACHER_TABLE;

/**
 * Generates a password satisfying this pool's policy (auth_stack.ts):
 * minLength 10, requires lowercase + uppercase + digit, symbols NOT
 * required. Excludes visually ambiguous characters (0/O, 1/l/I) since a
 * headteacher will likely be reading this aloud or writing it down to
 * hand to the teacher in person.
 */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  let pw = upper[crypto.randomInt(upper.length)]
    + lower[crypto.randomInt(lower.length)]
    + digits[crypto.randomInt(digits.length)];
  for (let i = 0; i < 7; i++) {
    pw += all[crypto.randomInt(all.length)];
  }
  return pw;
}

exports.handler = async (event) => {
  const input = event.arguments.input;
  const { school_id, first_name, last_name, email, phone_number } = input;

  if (!school_id || !first_name || !last_name || !phone_number) {
    throw new Error('school_id, first_name, last_name, and phone_number are all required');
  }

  const tempPassword = generateTempPassword();

  const userAttributes = [
    { Name: 'phone_number', Value: phone_number },
    { Name: 'phone_number_verified', Value: 'true' },
    { Name: 'custom:school_id', Value: school_id },
  ];
  if (email) {
    userAttributes.push({ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' });
  }

  let cognitoSub;
  try {
    const createRes = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: phone_number,
      UserAttributes: userAttributes,
      TemporaryPassword: tempPassword,
      MessageAction: 'SUPPRESS',
    }));
    cognitoSub = createRes.User.Attributes.find((a) => a.Name === 'sub')?.Value;
  } catch (err) {
    console.error('Failed to create Cognito user:', err);
    // Common real case: phone number already exists as a username in this
    // pool (e.g. re-registering someone, or a typo'd duplicate). Surface
    // a clearer message than the raw Cognito exception where possible.
    if (err.name === 'UsernameExistsException') {
      throw new Error(`An account already exists for ${phone_number}.`);
    }
    throw new Error(`Could not create a login for ${phone_number}: ${err.message}`);
  }

  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: phone_number,
      GroupName: 'Teacher',
    }));
  } catch (err) {
    console.error('Failed to add user to Teacher group:', err);
    throw new Error(`Login was created for ${phone_number}, but group assignment failed: ${err.message}. The account exists but cannot access teacher pages yet -- contact support.`);
  }

  const teacherId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await doc.send(new PutCommand({
      TableName: TEACHER_TABLE,
      Item: {
        id: teacherId,
        __typename: 'Teacher',
        school_id,
        first_name,
        last_name,
        email: email || null,
        phone_number,
        cognito_sub: cognitoSub,
        created_at: now,
        updated_at: now,
      },
    }));
  } catch (err) {
    console.error('Failed to create Teacher record after Cognito user was created:', err);
    throw new Error(`Login was created for ${phone_number}, but the teacher record failed to save: ${err.message}. The account exists but is not yet linked -- contact support.`);
  }

  return {
    teacher_id: teacherId,
    phone_number,
    temporary_password: tempPassword,
  };
};
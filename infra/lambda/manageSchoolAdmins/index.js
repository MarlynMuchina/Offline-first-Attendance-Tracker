/**
 * manageSchoolAdmins/index.js
 *
 * Lets Angaza staff (Admin group, custom:school_id = ANGAZA) look after the
 * admin login of every school from the network page:
 *
 *   LIST            every school admin, with status
 *   CREATE          a new admin login for a school (returns a temporary password)
 *   DISABLE/ENABLE  block or restore a school admin's sign-in
 *   RESET_PASSWORD  issue a new temporary password
 *
 * A school admin is a Cognito user in the Admin group whose custom:school_id
 * is a real school. Only Angaza callers are allowed, checked here from the
 * caller's token rather than trusted from the request (CSG Vol 2, sec 2.5).
 * Angaza accounts themselves can't be created, changed or listed here.
 */
const crypto = require('crypto');
const {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminSetUserPasswordCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.USER_POOL_ID;
const NETWORK_SCHOOL_ID = 'ANGAZA';
const ADMIN_GROUP = 'Admin';
const SCHOOL_ID_PATTERN = /^SCH\d{2,}$/;
const PHONE_PATTERN = /^\+254\d{9}$/;

// Same rules as createTeacherAccount: the pool needs 10+ characters with
// upper, lower and a digit. Look-alike characters are left out because the
// password is read out or written down for the new admin.
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  let pw = upper[crypto.randomInt(upper.length)]
    + lower[crypto.randomInt(lower.length)]
    + digits[crypto.randomInt(digits.length)];
  for (let i = 0; i < 7; i++) pw += all[crypto.randomInt(all.length)];
  return pw;
}

function attr(attributes, name) {
  return (attributes || []).find((a) => a.Name === name)?.Value ?? null;
}

function toAdmin(user) {
  const attributes = user.Attributes || user.UserAttributes;
  return {
    username: user.Username,
    phone_number: attr(attributes, 'phone_number'),
    name: attr(attributes, 'name'),
    school_id: attr(attributes, 'custom:school_id'),
    enabled: user.Enabled !== false,
    status: user.UserStatus || null,
    created_at: user.UserCreateDate ? new Date(user.UserCreateDate).toISOString() : null,
  };
}

// The app signs AppSync calls with the access token, which carries the
// groups but not custom:school_id, so the school is read from the caller's
// Cognito record when the token doesn't have it.
async function assertAngazaCaller(identity) {
  const claims = identity?.claims || {};
  const groups = claims['cognito:groups'] || identity?.groups || [];
  let schoolId = claims['custom:school_id'];
  if (!schoolId && identity?.username && groups.includes(ADMIN_GROUP)) {
    const caller = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: identity.username }));
    schoolId = attr(caller.UserAttributes, 'custom:school_id');
  }
  if (schoolId !== NETWORK_SCHOOL_ID || !groups.includes(ADMIN_GROUP)) {
    throw new Error('Only Angaza accounts can manage school admins.');
  }
}

async function listSchoolAdmins() {
  const admins = [];
  let nextToken;
  do {
    const res = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: ADMIN_GROUP,
      NextToken: nextToken,
    }));
    admins.push(...(res.Users || []).map(toAdmin));
    nextToken = res.NextToken;
  } while (nextToken);
  return admins
    .filter((a) => a.school_id && a.school_id !== NETWORK_SCHOOL_ID)
    .sort((a, b) => a.school_id.localeCompare(b.school_id) || (a.name || '').localeCompare(b.name || ''));
}

// Loads the target and refuses anything that isn't a school admin, so this
// can't be used to lock out an Angaza account or touch a teacher.
async function getSchoolAdmin(username) {
  if (!username) throw new Error('username is required');
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  const groups = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
  const admin = toAdmin(user);
  const isAdmin = (groups.Groups || []).some((g) => g.GroupName === ADMIN_GROUP);
  if (!isAdmin || !admin.school_id || admin.school_id === NETWORK_SCHOOL_ID) {
    throw new Error(`${username} is not a school admin.`);
  }
  return admin;
}

async function createSchoolAdmin({ school_id, first_name, last_name, phone_number }) {
  if (!SCHOOL_ID_PATTERN.test(school_id || '')) throw new Error('Pick a school (SCH01, SCH02, ...).');
  if (!first_name || !last_name) throw new Error('First and last name are required.');
  if (!PHONE_PATTERN.test(phone_number || '')) throw new Error('Phone must look like +2547XXXXXXXX.');

  const tempPassword = generateTempPassword();
  let created;
  try {
    created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: phone_number,
      UserAttributes: [
        { Name: 'phone_number', Value: phone_number },
        { Name: 'phone_number_verified', Value: 'true' },
        { Name: 'name', Value: `${first_name.trim()} ${last_name.trim()}` },
        { Name: 'custom:school_id', Value: school_id },
      ],
      TemporaryPassword: tempPassword,
      MessageAction: 'SUPPRESS',
    }));
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      throw new Error(`An account already exists for ${phone_number}.`);
    }
    throw err;
  }
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: USER_POOL_ID,
    Username: phone_number,
    GroupName: ADMIN_GROUP,
  }));
  return { admin: toAdmin(created.User), temporary_password: tempPassword };
}

exports.handler = async (event) => {
  await assertAngazaCaller(event.identity);
  const input = event.arguments?.input || {};

  switch (input.action) {
    case 'LIST':
      return { admins: await listSchoolAdmins() };
    case 'CREATE':
      return createSchoolAdmin(input);
    case 'DISABLE': {
      const admin = await getSchoolAdmin(input.username);
      await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: admin.username }));
      return { admin: { ...admin, enabled: false } };
    }
    case 'ENABLE': {
      const admin = await getSchoolAdmin(input.username);
      await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: admin.username }));
      return { admin: { ...admin, enabled: true } };
    }
    case 'RESET_PASSWORD': {
      const admin = await getSchoolAdmin(input.username);
      const tempPassword = generateTempPassword();
      await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: admin.username,
        Password: tempPassword,
        Permanent: false,
      }));
      return { admin: { ...admin, status: 'FORCE_CHANGE_PASSWORD' }, temporary_password: tempPassword };
    }
    default:
      throw new Error(`Unknown action ${input.action}`);
  }
};

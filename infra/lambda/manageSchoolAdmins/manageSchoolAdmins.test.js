/**
 * manageSchoolAdmins.test.js
 *
 * Covers: only Angaza callers allowed, listing skips Angaza accounts,
 * creating an admin puts them in the Admin group for the right school,
 * disable/enable/reset refuse anyone who isn't a school admin, and Angaza
 * can add schools that every admin can then read.
 *
 * Run: npx jest manageSchoolAdmins.test.js
 */

const mockSend = jest.fn();
const mockDbSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const command = (type) => jest.fn((params) => ({ type, ...params }));
  return {
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ListUsersInGroupCommand: command('ListUsersInGroup'),
    AdminCreateUserCommand: command('AdminCreateUser'),
    AdminAddUserToGroupCommand: command('AdminAddUserToGroup'),
    AdminGetUserCommand: command('AdminGetUser'),
    AdminListGroupsForUserCommand: command('AdminListGroupsForUser'),
    AdminDisableUserCommand: command('AdminDisableUser'),
    AdminEnableUserCommand: command('AdminEnableUser'),
    AdminSetUserPasswordCommand: command('AdminSetUserPassword'),
  };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const command = (type) => jest.fn((params) => ({ type, ...params }));
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDbSend }) },
    ScanCommand: command('Scan'),
    PutCommand: command('Put'),
  };
});

process.env.USER_POOL_ID = 'pool-test';
process.env.SCHOOLS_TABLE = 'schools-test';
const { handler } = require('./index');

const ANGAZA = { claims: { 'custom:school_id': 'ANGAZA', 'cognito:groups': ['Admin'] } };
const SCHOOL_ADMIN = { claims: { 'custom:school_id': 'SCH01', 'cognito:groups': ['Admin'] } };

function user(username, schoolId, extra = {}) {
  return {
    Username: username,
    Enabled: true,
    UserStatus: 'CONFIRMED',
    Attributes: [
      { Name: 'phone_number', Value: username },
      { Name: 'name', Value: `Admin ${schoolId}` },
      { Name: 'custom:school_id', Value: schoolId },
    ],
    ...extra,
  };
}

function call(input, identity = ANGAZA) {
  return handler({ arguments: { input }, identity });
}

function sent(type) {
  return mockSend.mock.calls.map(([c]) => c).filter((c) => c.type === type);
}

beforeEach(() => {
  mockSend.mockReset();
  mockDbSend.mockReset();
});

test('a school admin cannot use it', async () => {
  await expect(call({ action: 'LIST' }, SCHOOL_ADMIN)).rejects.toThrow(/Only Angaza/);
  expect(mockSend).not.toHaveBeenCalled();
});

test('an Angaza account outside the Admin group cannot use it', async () => {
  const identity = { claims: { 'custom:school_id': 'ANGAZA', 'cognito:groups': ['Teacher'] } };
  await expect(call({ action: 'LIST' }, identity)).rejects.toThrow(/Only Angaza/);
});

test('LIST returns school admins across pages, without Angaza accounts', async () => {
  mockSend
    .mockResolvedValueOnce({ Users: [user('+254700000002', 'SCH02'), user('+254700000000', 'ANGAZA')], NextToken: 't' })
    .mockResolvedValueOnce({ Users: [user('+254700000001', 'SCH01')] });
  const { admins } = await call({ action: 'LIST' });
  expect(admins.map((a) => a.school_id)).toEqual(['SCH01', 'SCH02']);
  expect(admins[0]).toMatchObject({ phone_number: '+254700000001', name: 'Admin SCH01', enabled: true });
});

test('CREATE makes an Admin-group login tied to the school', async () => {
  mockSend.mockImplementation(async (cmd) =>
    cmd.type === 'AdminCreateUser' ? { User: user('+254711111111', 'SCH03') } : {});
  const res = await call({
    action: 'CREATE', school_id: 'SCH03', first_name: 'Jane', last_name: 'Doe', phone_number: '+254711111111',
  });
  const [create] = sent('AdminCreateUser');
  expect(create.UserAttributes).toEqual(expect.arrayContaining([
    { Name: 'custom:school_id', Value: 'SCH03' },
    { Name: 'name', Value: 'Jane Doe' },
  ]));
  expect(create.MessageAction).toBe('SUPPRESS');
  expect(sent('AdminAddUserToGroup')[0].GroupName).toBe('Admin');
  expect(res.temporary_password).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{10}$/);
});

test('CREATE refuses the Angaza school id', async () => {
  await expect(call({
    action: 'CREATE', school_id: 'ANGAZA', first_name: 'A', last_name: 'B', phone_number: '+254711111111',
  })).rejects.toThrow(/Pick a school/);
  expect(mockSend).not.toHaveBeenCalled();
});

test('CREATE checks the phone format', async () => {
  await expect(call({
    action: 'CREATE', school_id: 'SCH01', first_name: 'A', last_name: 'B', phone_number: '0711111111',
  })).rejects.toThrow(/\+2547/);
});

test('CREATE explains a duplicate phone number', async () => {
  mockSend.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'UsernameExistsException' }));
  await expect(call({
    action: 'CREATE', school_id: 'SCH01', first_name: 'A', last_name: 'B', phone_number: '+254711111111',
  })).rejects.toThrow(/already exists/);
});

function mockTarget(target, groups = ['Admin']) {
  mockSend.mockImplementation(async (cmd) => {
    if (cmd.type === 'AdminGetUser') return { ...target, UserAttributes: target.Attributes };
    if (cmd.type === 'AdminListGroupsForUser') return { Groups: groups.map((GroupName) => ({ GroupName })) };
    return {};
  });
}

test('DISABLE and ENABLE a school admin', async () => {
  mockTarget(user('+254700000001', 'SCH01'));
  expect((await call({ action: 'DISABLE', username: '+254700000001' })).admin.enabled).toBe(false);
  expect((await call({ action: 'ENABLE', username: '+254700000001' })).admin.enabled).toBe(true);
  expect(sent('AdminDisableUser')).toHaveLength(1);
  expect(sent('AdminEnableUser')).toHaveLength(1);
});

test('cannot disable an Angaza account', async () => {
  mockTarget(user('+254700000000', 'ANGAZA'));
  await expect(call({ action: 'DISABLE', username: '+254700000000' })).rejects.toThrow(/not a school admin/);
  expect(sent('AdminDisableUser')).toHaveLength(0);
});

test('cannot disable a teacher', async () => {
  mockTarget(user('+254700000005', 'SCH01'), ['Teacher']);
  await expect(call({ action: 'DISABLE', username: '+254700000005' })).rejects.toThrow(/not a school admin/);
});

test('RESET_PASSWORD issues a temporary password the admin must change', async () => {
  mockTarget(user('+254700000001', 'SCH01'));
  const res = await call({ action: 'RESET_PASSWORD', username: '+254700000001' });
  const [set] = sent('AdminSetUserPassword');
  expect(set.Permanent).toBe(false);
  expect(set.Password).toBe(res.temporary_password);
});

test('works with an access token that has no school claim', async () => {
  mockSend
    .mockResolvedValueOnce({ UserAttributes: [{ Name: 'custom:school_id', Value: 'ANGAZA' }] })
    .mockResolvedValueOnce({ Users: [user('+254700000001', 'SCH01')] });
  const identity = { username: 'angaza-user', claims: { 'cognito:groups': ['Admin'] } };
  const { admins } = await call({ action: 'LIST' }, identity);
  expect(admins).toHaveLength(1);
});

test('a school admin with an access token is still refused', async () => {
  mockSend.mockResolvedValueOnce({ UserAttributes: [{ Name: 'custom:school_id', Value: 'SCH01' }] });
  const identity = { username: 'sch01-admin', claims: { 'cognito:groups': ['Admin'] } };
  await expect(call({ action: 'LIST' }, identity)).rejects.toThrow(/Only Angaza/);
});

const TEACHER = { claims: { 'custom:school_id': 'SCH01', 'cognito:groups': ['Teacher'] } };
const NEW_SCHOOL = { action: 'CREATE_SCHOOL', school_name: 'Kilimani Day School', school_type: 'Mixed', county: 'Nairobi' };

function dbSent(type) {
  return mockDbSend.mock.calls.map(([c]) => c).filter((c) => c.type === type);
}

test('CREATE_SCHOOL gives the first new school SCH06', async () => {
  mockDbSend.mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({});
  const res = await call(NEW_SCHOOL);
  expect(res.school).toMatchObject({ school_id: 'SCH06', name: 'Kilimani Day School', type: 'Mixed', county: 'Nairobi' });
  const [put] = dbSent('Put');
  expect(put.TableName).toBe('schools-test');
  expect(put.ConditionExpression).toBe('attribute_not_exists(school_id)');
});

test('CREATE_SCHOOL numbers after schools already added', async () => {
  mockDbSend
    .mockResolvedValueOnce({ Items: [{ school_id: 'SCH06', name: 'A' }, { school_id: 'SCH09', name: 'B' }] })
    .mockResolvedValueOnce({});
  const res = await call(NEW_SCHOOL);
  expect(res.school.school_id).toBe('SCH10');
});

test('CREATE_SCHOOL refuses a name already in the network', async () => {
  mockDbSend.mockResolvedValueOnce({ Items: [{ school_id: 'SCH06', name: 'kilimani day school' }] });
  await expect(call(NEW_SCHOOL)).rejects.toThrow(/already in the network/);
  expect(dbSent('Put')).toHaveLength(0);
});

test('CREATE_SCHOOL checks the name, type and county', async () => {
  await expect(call({ ...NEW_SCHOOL, school_name: ' ' })).rejects.toThrow(/name is required/);
  await expect(call({ ...NEW_SCHOOL, school_type: 'Other' })).rejects.toThrow(/Mixed, Girls or Boys/);
  await expect(call({ ...NEW_SCHOOL, county: '' })).rejects.toThrow(/county is required/);
  expect(mockDbSend).not.toHaveBeenCalled();
});

test('CREATE_SCHOOL explains a clash with a school added at the same moment', async () => {
  const clash = Object.assign(new Error('clash'), { name: 'ConditionalCheckFailedException' });
  mockDbSend.mockResolvedValueOnce({ Items: [] }).mockRejectedValueOnce(clash);
  await expect(call(NEW_SCHOOL)).rejects.toThrow(/try again/);
});

test('a school admin cannot add a school', async () => {
  await expect(call(NEW_SCHOOL, SCHOOL_ADMIN)).rejects.toThrow(/Only Angaza/);
  expect(mockDbSend).not.toHaveBeenCalled();
});

test('LIST_SCHOOLS is open to every admin, across pages, sorted', async () => {
  mockDbSend
    .mockResolvedValueOnce({ Items: [{ school_id: 'SCH07', name: 'B' }], LastEvaluatedKey: { school_id: 'SCH07' } })
    .mockResolvedValueOnce({ Items: [{ school_id: 'SCH06', name: 'A' }] });
  const res = await call({ action: 'LIST_SCHOOLS' }, SCHOOL_ADMIN);
  expect(res.schools.map((s) => s.school_id)).toEqual(['SCH06', 'SCH07']);
  expect(mockSend).not.toHaveBeenCalled();
});

test('LIST_SCHOOLS refuses a teacher', async () => {
  await expect(call({ action: 'LIST_SCHOOLS' }, TEACHER)).rejects.toThrow(/Only admins/);
});

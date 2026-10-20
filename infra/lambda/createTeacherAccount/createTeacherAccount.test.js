/**
 * createTeacherAccount.test.js
 *
 * Covers the three steps (Cognito user, Teacher group, Teacher record), the
 * temporary password rules, the own-school check, and the error message for
 * each step that can fail.
 *
 * Run: npx jest createTeacherAccount.test.js
 */

const mockCognitoSend = jest.fn();
const mockDocSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  AdminCreateUserCommand: jest.fn((params) => ({ __type: 'AdminCreateUserCommand', ...params })),
  AdminAddUserToGroupCommand: jest.fn((params) => ({ __type: 'AdminAddUserToGroupCommand', ...params })),
  AdminGetUserCommand: jest.fn((params) => ({ __type: 'AdminGetUserCommand', ...params })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  PutCommand: jest.fn((params) => ({ __type: 'PutCommand', ...params })),
}));

process.env.USER_POOL_ID = 'eu-north-1_test';
process.env.TEACHER_TABLE = 'Teacher-test-NONE';

const { handler } = require('./index');

const SCH01_ADMIN = { claims: { 'custom:school_id': 'SCH01' } };
const INPUT = {
  school_id: 'SCH01',
  first_name: 'Jackie',
  last_name: 'Nyaboga',
  phone_number: '+254700000002',
};

// Cognito's answers for a successful create and group add
function cognitoSucceeds() {
  mockCognitoSend.mockImplementation(async (cmd) => {
    if (cmd.__type === 'AdminCreateUserCommand') {
      return { User: { Attributes: [{ Name: 'sub', Value: 'sub-123' }] } };
    }
    return {};
  });
}

const sentOfType = (type) => mockCognitoSend.mock.calls.map(([c]) => c).filter((c) => c.__type === type);

beforeEach(() => {
  mockCognitoSend.mockReset();
  mockDocSend.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createTeacherAccount', () => {
  test('creates the login, adds it to Teacher and saves a linked Teacher record', async () => {
    cognitoSucceeds();
    mockDocSend.mockResolvedValue({});

    const result = await handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN });

    const [create] = sentOfType('AdminCreateUserCommand');
    expect(create).toMatchObject({ UserPoolId: 'eu-north-1_test', Username: '+254700000002', MessageAction: 'SUPPRESS' });
    expect(create.UserAttributes).toEqual(expect.arrayContaining([{ Name: 'custom:school_id', Value: 'SCH01' }]));
    expect(sentOfType('AdminAddUserToGroupCommand')[0]).toMatchObject({ GroupName: 'Teacher', Username: '+254700000002' });

    const put = mockDocSend.mock.calls[0][0];
    expect(put.TableName).toBe('Teacher-test-NONE');
    expect(put.Item).toMatchObject({ school_id: 'SCH01', cognito_sub: 'sub-123', email: null, __typename: 'Teacher' });
    expect(result).toEqual({
      teacher_id: put.Item.id,
      phone_number: '+254700000002',
      temporary_password: create.TemporaryPassword,
    });
  });

  test('the temporary password meets the pool policy and avoids look-alike characters', async () => {
    cognitoSucceeds();
    mockDocSend.mockResolvedValue({});

    for (let i = 0; i < 20; i++) {
      const { temporary_password: pw } = await handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN });
      expect(pw).toHaveLength(10);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });

  test('adds a verified email when one is given', async () => {
    cognitoSucceeds();
    mockDocSend.mockResolvedValue({});

    await handler({ arguments: { input: { ...INPUT, email: 'jackie@example.com' } }, identity: SCH01_ADMIN });

    expect(sentOfType('AdminCreateUserCommand')[0].UserAttributes).toEqual(expect.arrayContaining([
      { Name: 'email', Value: 'jackie@example.com' },
      { Name: 'email_verified', Value: 'true' },
    ]));
    expect(mockDocSend.mock.calls[0][0].Item.email).toBe('jackie@example.com');
  });

  test('requires the school, both names and the phone number', async () => {
    const { phone_number, ...missingPhone } = INPUT;
    await expect(handler({ arguments: { input: missingPhone }, identity: SCH01_ADMIN }))
      .rejects.toThrow('school_id, first_name, last_name, and phone_number are all required');
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  test("refuses to add a teacher to another school", async () => {
    await expect(handler({ arguments: { input: { ...INPUT, school_id: 'SCH02' } }, identity: SCH01_ADMIN }))
      .rejects.toThrow("You can only work with your own school's data.");
    expect(sentOfType('AdminCreateUserCommand')).toHaveLength(0);
  });

  test("reads the admin's school from Cognito when the token has none", async () => {
    mockCognitoSend.mockImplementation(async (cmd) => {
      if (cmd.__type === 'AdminGetUserCommand') return { UserAttributes: [{ Name: 'custom:school_id', Value: 'SCH01' }] };
      if (cmd.__type === 'AdminCreateUserCommand') return { User: { Attributes: [{ Name: 'sub', Value: 'sub-9' }] } };
      return {};
    });
    mockDocSend.mockResolvedValue({});

    await handler({ arguments: { input: INPUT }, identity: { username: 'sch01-admin' } });

    expect(sentOfType('AdminGetUserCommand')[0]).toMatchObject({ Username: 'sch01-admin' });
  });

  test('refuses a call with no signed-in user', async () => {
    await expect(handler({ arguments: { input: INPUT }, identity: {} })).rejects.toThrow('Not signed in.');
  });

  test('refuses an admin account that has no school', async () => {
    mockCognitoSend.mockResolvedValue({ UserAttributes: [] });
    await expect(handler({ arguments: { input: INPUT }, identity: { username: 'no-school-admin' } }))
      .rejects.toThrow('This account has no school.');
  });

  test('says clearly when the phone number already has an account', async () => {
    mockCognitoSend.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'UsernameExistsException' }));
    await expect(handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN }))
      .rejects.toThrow('An account already exists for +254700000002.');
  });

  test('passes on any other Cognito error', async () => {
    mockCognitoSend.mockRejectedValueOnce(new Error('invalid phone'));
    await expect(handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN }))
      .rejects.toThrow('Could not create a login for +254700000002: invalid phone');
  });

  test('explains when the login exists but the group step failed', async () => {
    mockCognitoSend
      .mockResolvedValueOnce({ User: { Attributes: [{ Name: 'sub', Value: 'sub-1' }] } })
      .mockRejectedValueOnce(new Error('group missing'));
    await expect(handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN }))
      .rejects.toThrow('group assignment failed: group missing');
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  test('explains when the login exists but the teacher record failed to save', async () => {
    cognitoSucceeds();
    mockDocSend.mockRejectedValue(new Error('table not found'));
    await expect(handler({ arguments: { input: INPUT }, identity: SCH01_ADMIN }))
      .rejects.toThrow('the teacher record failed to save: table not found');
  });
});

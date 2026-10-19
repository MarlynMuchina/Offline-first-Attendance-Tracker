/**
 * sendSmsAlert.test.js
 *
 * Mirrors the mocking pattern used in predictAttendanceRisk.test.js:
 * mock the AWS SDK and the africastalking package at module level, then
 * exercise the real handler.
 *
 * Covers:
 *  - both invocation shapes (AppSync mutation vs. checkThreshold's direct
 *    InvokeCommand) via event.arguments?.input ?? event
 *  - credential caching across warm-container invocations (and the
 *    resulting staleness-after-rotation risk, documented as a known
 *    tradeoff during tonight's key-rotation incident)
 *  - success/failure branching based on Africa's Talking's response shape
 *  - NotificationLog write always happens, even on failure (audit trail
 *    should reflect attempted sends, not just successful ones)
 *  - graceful handling of a thrown exception from the AT SDK itself
 *    (network error, invalid key, etc.) vs. a clean FAILED response
 *
 * Run: npx jest sendSmsAlert.test.js
 */

const mockDocSend = jest.fn();
const mockSecretsSend = jest.fn();
const mockAtSmsSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((params) => params),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDocSend })),
  },
  GetCommand: jest.fn((params) => params),
  PutCommand: jest.fn((params) => params),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  AdminGetUserCommand: jest.fn((params) => ({ __type: 'AdminGetUserCommand', ...params })),
}));

// africastalking is required lazily inside the handler (require('africastalking')(...)),
// after credentials are fetched -- mock the module so we control SMS.send() per test.
jest.mock('africastalking', () => {
  return jest.fn(() => ({
    SMS: { send: mockAtSmsSend },
  }));
});

process.env.NOTIFICATION_TABLE = 'NotificationLog-test-NONE';
process.env.AT_SECRET_NAME = 'test-at-credentials';

// index.js caches credentials in a module-level variable, so each test file
// run shares one cache -- reset the module registry between tests to get a
// truly fresh cachedCredentials = null for tests that need to verify the
// "fetch once" behavior in isolation.
function freshHandler() {
  jest.resetModules();
  // Re-establish mocks after resetModules clears the module registry.
  jest.doMock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSecretsSend })),
    GetSecretValueCommand: jest.fn((params) => params),
  }));
  jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
  }));
  jest.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
    GetCommand: jest.fn((params) => params),
    PutCommand: jest.fn((params) => params),
  }));
  jest.doMock('@aws-sdk/client-cognito-identity-provider', () => ({
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
    AdminGetUserCommand: jest.fn((params) => params),
  }));
  jest.doMock('africastalking', () => jest.fn(() => ({ SMS: { send: mockAtSmsSend } })));
  return require('./index').handler;
}

beforeEach(() => {
  mockDocSend.mockReset();
  mockSecretsSend.mockReset();
  mockAtSmsSend.mockReset();
  mockCognitoSend.mockReset();
});

const VALID_INPUT = {
  school_id: 'SCH01',
  student_id: 'SCH01-S001',
  guardian_phone: '+254721384842',
  message: 'Test alert message',
};

const SCH01_CALLER = { claims: { 'custom:school_id': 'SCH01' } };
const STUDENT_ON_FILE = { id: 'SCH01-S001', school_id: 'SCH01', guardian_phone: '+254721384842' };

const VALID_SECRET = {
  SecretString: JSON.stringify({ apiKey: 'atsk_testkey', username: 'sandbox' }),
};

const AT_SUCCESS_RESPONSE = {
  SMSMessageData: { Recipients: [{ status: 'Success' }] },
};

const AT_FAILURE_RESPONSE = {
  SMSMessageData: { Recipients: [{ status: 'InvalidPhoneNumber' }] },
};

describe('sendSmsAlert handler', () => {
  test('supports both AppSync (arguments.input) and direct-invoke shapes', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockImplementation(async (params) => (params.Key ? { Item: STUDENT_ON_FILE } : {}));

    const viaAppSync = await handler({ arguments: { input: VALID_INPUT }, identity: SCH01_CALLER });
    expect(viaAppSync.success).toBe(true);

    const viaDirectInvoke = await handler(VALID_INPUT);
    expect(viaDirectInvoke.success).toBe(true);
  });

  test('a successful AT send returns success:true, status:SENT', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockResolvedValue({});

    const result = await handler(VALID_INPUT);

    expect(result.success).toBe(true);
    expect(result.status).toBe('SENT');
    expect(result.notification_id).toBeTruthy();
  });

  test('a non-Success AT recipient status returns success:false, status:FAILED', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_FAILURE_RESPONSE);
    mockDocSend.mockResolvedValue({});

    const result = await handler(VALID_INPUT);

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
  });

  test('an exception from the AT SDK (network error, bad key, etc.) is caught, not thrown', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockRejectedValue(new Error('Request failed with status code 401'));
    mockDocSend.mockResolvedValue({});

    // Regression guard for tonight's actual incident: a 401 from AT must
    // resolve to a FAILED response, not an unhandled Lambda crash.
    await expect(handler(VALID_INPUT)).resolves.toMatchObject({
      success: false,
      status: 'FAILED',
    });
  });

  test('writes to NotificationLog on success', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockResolvedValue({});

    await handler(VALID_INPUT);

    expect(mockDocSend).toHaveBeenCalledTimes(1);
    const putCall = mockDocSend.mock.calls[0][0];
    expect(putCall.TableName).toBe('NotificationLog-test-NONE');
    expect(putCall.Item.status).toBe('SENT');
    expect(putCall.Item.student_id).toBe('SCH01-S001');
    expect(putCall.Item.channel).toBe('SMS');
  });

  test('writes to NotificationLog even when the send fails (audit trail of attempts, not just successes)', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockRejectedValue(new Error('network error'));
    mockDocSend.mockResolvedValue({});

    await handler(VALID_INPUT);

    expect(mockDocSend).toHaveBeenCalledTimes(1);
    expect(mockDocSend.mock.calls[0][0].Item.status).toBe('FAILED');
  });

  test('fetches the secret only once across multiple invocations (warm-container credential caching)', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockResolvedValue({});

    await handler(VALID_INPUT);
    await handler(VALID_INPUT);
    await handler(VALID_INPUT);

    // This is the exact behavior that caused tonight's stale-credential
    // confusion during key rotation -- caching is intentional for warm-start
    // performance, but it means a rotated secret only takes effect on the
    // NEXT cold start, not immediately. Documented here so it's never
    // "rediscovered" as a surprise again.
    expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    expect(mockAtSmsSend).toHaveBeenCalledTimes(3);
  });

  test('sends to the guardian_phone from input, not a hardcoded number', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockResolvedValue({});

    const customInput = { ...VALID_INPUT, guardian_phone: '+254799999999' };
    await handler(customInput);

    const sendCallArgs = mockAtSmsSend.mock.calls[0][0];
    expect(sendCallArgs.to).toEqual(['+254799999999']);
  });

  test('each notification gets a unique notification_id across calls', async () => {
    const handler = freshHandler();
    mockSecretsSend.mockResolvedValue(VALID_SECRET);
    mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
    mockDocSend.mockResolvedValue({});

    const r1 = await handler(VALID_INPUT);
    const r2 = await handler(VALID_INPUT);

    expect(r1.notification_id).not.toBe(r2.notification_id);
  });

  describe('calls through the API', () => {
    function apiCall(input, identity = SCH01_CALLER) {
      return freshHandler()({ arguments: { input }, identity });
    }

    beforeEach(() => {
      mockSecretsSend.mockResolvedValue(VALID_SECRET);
      mockAtSmsSend.mockResolvedValue(AT_SUCCESS_RESPONSE);
      mockDocSend.mockImplementation(async (params) => (params.Key ? { Item: STUDENT_ON_FILE } : {}));
    });

    test('refuses a caller from another school', async () => {
      await expect(apiCall(VALID_INPUT, { claims: { 'custom:school_id': 'SCH02' } }))
        .rejects.toThrow("You can only work with your own school's data.");
      expect(mockAtSmsSend).not.toHaveBeenCalled();
    });

    test('refuses a student from another school', async () => {
      mockDocSend.mockImplementation(async (params) => (
        params.Key ? { Item: { ...STUDENT_ON_FILE, school_id: 'SCH02' } } : {}
      ));
      await expect(apiCall(VALID_INPUT)).rejects.toThrow(/guardian on file/);
      expect(mockAtSmsSend).not.toHaveBeenCalled();
    });

    test('refuses a number that is not the guardian on file', async () => {
      await expect(apiCall({ ...VALID_INPUT, guardian_phone: '+254799999999' })).rejects.toThrow(/guardian on file/);
      expect(mockAtSmsSend).not.toHaveBeenCalled();
    });

    test("reads the caller's school from Cognito when the token doesn't carry it", async () => {
      mockCognitoSend.mockResolvedValue({ UserAttributes: [{ Name: 'custom:school_id', Value: 'SCH01' }] });
      const result = await apiCall(VALID_INPUT, { username: '+254700000001' });
      expect(result.success).toBe(true);
      expect(mockCognitoSend).toHaveBeenCalledTimes(1);
    });
  });
});

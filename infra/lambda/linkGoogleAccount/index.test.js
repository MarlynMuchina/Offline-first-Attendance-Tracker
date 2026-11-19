const { mockClient } = require('aws-sdk-client-mock');
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const { handler } = require('./index');

function googleEvent(overrides = {}) {
  return {
    triggerSource: 'PreSignUp_ExternalProvider',
    userPoolId: 'eu-north-1_pool',
    userName: 'google_1234567890',
    request: { userAttributes: { email: 'Jackie@Example.com' } },
    response: {},
    ...overrides,
  };
}

beforeEach(() => cognitoMock.reset());

describe('linkGoogleAccount', () => {
  test('lets ordinary sign-ups through untouched', async () => {
    const event = { triggerSource: 'PreSignUp_AdminCreateUser', userName: 'abc', request: {} };
    await expect(handler(event)).resolves.toBe(event);
    expect(cognitoMock.calls()).toHaveLength(0);
  });

  test('links Google to the existing account with the same email', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [{ Username: 'teacher-uuid', Enabled: true, UserStatus: 'CONFIRMED' }],
    });
    cognitoMock.on(AdminLinkProviderForUserCommand).resolves({});

    const event = googleEvent();
    await expect(handler(event)).resolves.toBe(event);

    const list = cognitoMock.commandCalls(ListUsersCommand)[0].args[0].input;
    expect(list.Filter).toBe('email = "jackie@example.com"');
    const link = cognitoMock.commandCalls(AdminLinkProviderForUserCommand)[0].args[0].input;
    expect(link.DestinationUser).toEqual({ ProviderName: 'Cognito', ProviderAttributeValue: 'teacher-uuid' });
    expect(link.SourceUser).toEqual({
      ProviderName: 'Google',
      ProviderAttributeName: 'Cognito_Subject',
      ProviderAttributeValue: '1234567890',
    });
  });

  test('refuses a Google account with no matching CSG account', async () => {
    cognitoMock.on(ListUsersCommand).resolves({ Users: [] });
    await expect(handler(googleEvent())).rejects.toThrow('NO_CSG_ACCOUNT');
    expect(cognitoMock.commandCalls(AdminLinkProviderForUserCommand)).toHaveLength(0);
  });

  test('refuses when the matching account is disabled', async () => {
    cognitoMock.on(ListUsersCommand).resolves({
      Users: [{ Username: 'old', Enabled: false, UserStatus: 'CONFIRMED' }],
    });
    await expect(handler(googleEvent())).rejects.toThrow('NO_CSG_ACCOUNT');
  });

  test('refuses an email that could break the filter', async () => {
    const event = googleEvent({ request: { userAttributes: { email: 'a"b@example.com' } } });
    await expect(handler(event)).rejects.toThrow('NO_CSG_ACCOUNT');
    expect(cognitoMock.calls()).toHaveLength(0);
  });

  test('refuses other providers and missing emails', async () => {
    await expect(handler(googleEvent({ userName: 'facebook_1' }))).rejects.toThrow('NO_CSG_ACCOUNT');
    await expect(handler(googleEvent({ request: { userAttributes: {} } }))).rejects.toThrow('NO_CSG_ACCOUNT');
  });
});

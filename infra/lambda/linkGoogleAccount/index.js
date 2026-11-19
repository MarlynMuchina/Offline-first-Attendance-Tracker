/**
 * Cognito pre sign-up trigger for "Continue with Google".
 *
 * There is no public sign-up: every account is created by the level above
 * (Angaza -> school admins -> teachers). So a Google sign-in is only allowed
 * when an existing, enabled account already has the same email address. The
 * Google identity is then linked to that account, so the person signs in as
 * themselves, with their own role and school. Anyone else is refused, and no
 * new user is created.
 *
 * Native (phone/password) sign-ups and admin-created users pass through
 * unchanged.
 */
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({});

// Shown to the person (via the login page) when no account matches.
const NO_ACCOUNT = 'NO_CSG_ACCOUNT';

exports.handler = async (event) => {
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') return event;

  // event.userName looks like "google_1234567890"; the part after the first
  // underscore is Google's id for the person.
  const cut = event.userName.indexOf('_');
  const provider = event.userName.slice(0, cut).toLowerCase();
  const providerUserId = event.userName.slice(cut + 1);
  if (provider !== 'google' || !providerUserId) throw new Error(NO_ACCOUNT);

  const email = String(event.request.userAttributes?.email || '').trim().toLowerCase();
  // A plain address only, so it can go safely into the ListUsers filter.
  if (!/^[^\s"\\]+@[^\s"\\]+$/.test(email)) throw new Error(NO_ACCOUNT);

  const found = await cognito.send(new ListUsersCommand({
    UserPoolId: event.userPoolId,
    Filter: `email = "${email}"`,
    Limit: 10,
  }));
  const account = (found.Users || []).find((u) => u.Enabled && u.UserStatus !== 'EXTERNAL_PROVIDER');
  if (!account) throw new Error(NO_ACCOUNT);

  await cognito.send(new AdminLinkProviderForUserCommand({
    UserPoolId: event.userPoolId,
    DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: account.Username },
    SourceUser: {
      ProviderName: 'Google',
      ProviderAttributeName: 'Cognito_Subject',
      ProviderAttributeValue: providerUserId,
    },
  }));

  // Linked. Cognito may still report "Already found an entry" for this first
  // attempt; the login page retries once, and from then on the Google
  // sign-in opens the existing account directly.
  return event;
};

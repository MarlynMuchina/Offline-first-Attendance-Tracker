import { Amplify } from 'aws-amplify'
import { Hub } from 'aws-amplify/utils'
import awsconfig from './lib/amplifyconfiguration.json'
import { forgetSession } from './lib/offlineSession'
import { markActive, forgetActivity } from './lib/idleSignOut'

Amplify.configure(awsconfig)

// Signing out (from any page) also removes the sign-in saved for offline use.
// Signing in counts as activity for the automatic sign-out.
Hub.listen('auth', ({ payload }) => {
  if (payload.event === 'signedIn') markActive()
  if (payload.event === 'signedOut') {
    forgetSession()
    forgetActivity()
  }
})

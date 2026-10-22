import { Amplify } from 'aws-amplify'
import { Hub } from 'aws-amplify/utils'
import awsconfig from './lib/amplifyconfiguration.json'
import { forgetSession } from './lib/offlineSession'

Amplify.configure(awsconfig)

// Signing out (from any page) also removes the sign-in saved for offline use.
Hub.listen('auth', ({ payload }) => {
  if (payload.event === 'signedOut') forgetSession()
})

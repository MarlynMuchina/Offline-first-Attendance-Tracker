#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../stacks/auth_stack';
import { ApiStack } from '../stacks/api_stack';

const app = new cdk.App();

// Account/region come from CDK context or environment, never hardcoded,
// so swapping from the interim personal AWS account to Angaza's account
// later is a config change, not a code change.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'af-south-1',
};

const stackPrefix = app.node.tryGetContext('stackPrefix') || 'csg-attendance';

const authStack = new AuthStack(app, `${stackPrefix}-auth-stack`, { env });

new ApiStack(app, `${stackPrefix}-api-stack`, {
  env,
  userPool: authStack.userPool,
});

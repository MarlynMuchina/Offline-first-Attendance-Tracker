import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';
import { AmplifyGraphqlApi, AmplifyGraphqlDefinition } from '@aws-amplify/graphql-api-construct';

interface ApiStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
}

/**
 * ApiStack — Amplify-transformed GraphQL API.
 *
 * Sprint 1 change: replaced the plain CDK `appsync.GraphqlApi` construct with
 * `AmplifyGraphqlApi`, which runs the schema through Amplify's GraphQL
 * Transformer. This is what auto-generates the DynamoDB tables, resolvers,
 * and sync/delta-query support that Amplify DataStore requires for offline
 * sync on the frontend. Without this, DataStore's local queue would have
 * nowhere correctly-shaped to sync into.
 *
 * Install: npm install @aws-amplify/graphql-api-construct
 */
export class ApiStack extends cdk.Stack {
  public readonly api: AmplifyGraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.api = new AmplifyGraphqlApi(this, 'AttendanceApi', {
      definition: AmplifyGraphqlDefinition.fromFiles(
        path.join(__dirname, '../../graphql/schema/schema.graphql')
      ),
      authorizationModes: {
        defaultAuthorizationMode: 'AMAZON_COGNITO_USER_POOLS',
        userPoolConfig: { userPool: props.userPool },
      },
    });

    new cdk.CfnOutput(this, 'GraphQLApiUrl', {
      value: this.api.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl,
    });
    new cdk.CfnOutput(this, 'GraphQLApiId', {
      value: this.api.resources.cfnResources.cfnGraphqlApi.attrApiId,
    });
  }
}

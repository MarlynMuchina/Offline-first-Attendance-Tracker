import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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
 * Sprint 2 change (issue #23): added a custom `markAttendance` mutation
 * backed by a real Lambda function, replacing direct frontend calls to the
 * auto-generated createAttendanceRecord/updateAttendanceRecord mutations.
 * The Lambda validates input, looks up any existing record for the
 * student/class/date, and applies last-write-wins + idempotency logic
 * before writing -- none of which the raw @model resolvers do. It also
 * emits an AttendanceRecorded event to EventBridge on every outcome
 * (CREATED/UPDATED/IDEMPOTENT_REPLAY/STALE_WRITE_REJECTED), routed to a
 * CloudWatch Log Group as a sync audit trail (issue #24).
 *
 * Sprint 2 change (issue #28): added a `generateAttendanceSummary` query
 * backed by a Lambda that aggregates attendance stats for a class/date
 * range and calls Claude (via Bedrock, EU cross-region inference profile)
 * for a plain-language summary. Model access confirmed via
 * `aws bedrock list-inference-profiles` -- this account's Bedrock models
 * all require inference profiles, not direct on-demand invocation.
 *
 * Install: npm install @aws-amplify/graphql-api-construct
 */
export class ApiStack extends cdk.Stack {
  public readonly api: AmplifyGraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ---- Shared table references ----
    const attendanceTable = dynamodb.Table.fromTableName(
      this,
      'ImportedAttendanceTable',
      'AttendanceRecord-wtgwzva7hvcrljtyfsbjgqiora-NONE'
    );

    const studentTable = dynamodb.Table.fromTableName(
      this,
      'ImportedStudentTable',
      'Student-wtgwzva7hvcrljtyfsbjgqiora-NONE'
    );

    // ---- markAttendance function (issue #23) ----
    const markAttendanceFn = new lambda.Function(this, 'MarkAttendanceFunction', {
      functionName: 'markAttendanceFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/markAttendance')),
      environment: {
        TABLE_NAME: attendanceTable.tableName,
      },
    });

    attendanceTable.grantReadWriteData(markAttendanceFn);
    markAttendanceFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${attendanceTable.tableArn}/index/*`],
    }));

    // Sync audit log (issue #24): EventBridge -> CloudWatch Logs
    const defaultBus = events.EventBus.fromEventBusName(this, 'DefaultBus', 'default');
    defaultBus.grantPutEventsTo(markAttendanceFn);

    const auditLogGroup = new logs.LogGroup(this, 'AttendanceAuditLogGroup', {
      logGroupName: '/csg/attendance-audit',
      retention: logs.RetentionDays.ONE_MONTH,
    });

    new events.Rule(this, 'AttendanceAuditRule', {
      eventBus: defaultBus,
      eventPattern: {
        source: ['csg.attendance'],
        detailType: ['AttendanceRecorded'],
      },
      targets: [new targets.CloudWatchLogGroup(auditLogGroup)],
    });

    // ---- generateAttendanceSummary function (issue #28) ----
    const attendanceSummaryFn = new lambda.Function(this, 'AttendanceSummaryFunction', {
      functionName: 'attendanceSummaryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/attendanceSummary')),
      environment: {
        ATTENDANCE_TABLE: attendanceTable.tableName,
        STUDENT_TABLE: studentTable.tableName,
      },
    });


    const notificationTable = dynamodb.Table.fromTableName(
  this, 'ImportedNotificationTable', 'NotificationLog-wtgwzva7hvcrljtyfsbjgqiora-NONE'
);

const atSecret = secretsmanager.Secret.fromSecretNameV2(
  this, 'AfricasTalkingSecret', 'csg-africastalking-credentials'
);

const sendSmsFn = new lambda.Function(this, 'SendSmsAlertFunction', {
  functionName: 'sendSmsFunction',
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  timeout: cdk.Duration.seconds(15),
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/sendSmsAlert')),
  environment: {
    NOTIFICATION_TABLE: notificationTable.tableName,
    AT_SECRET_NAME: 'csg-africastalking-credentials',
    NODE_OPTIONS: '--tls-min-v1.0', // Node 18's OpenSSL 3.x defaults reject Africa's Talking sandbox's TLS handshake — see issue #34
  },
});

notificationTable.grantWriteData(sendSmsFn);
atSecret.grantRead(sendSmsFn);

// ---- checkThreshold function (issue #35, Phase C) ----
// Triggered by AttendanceRecorded events (ABSENT only) from markAttendanceFn.
// Checks 3-consecutive-absence or <70%-monthly-rate, dedupes against
// NotificationLog (7-day window), and invokes sendSmsFn directly on trigger.
const checkThresholdFn = new lambda.Function(this, 'CheckThresholdFunction', {
  functionName: 'checkThresholdFunction',
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  timeout: cdk.Duration.seconds(30),
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/checkThreshold')),
  environment: {
    ATTENDANCE_TABLE: attendanceTable.tableName,
    NOTIFICATION_TABLE: notificationTable.tableName,
    STUDENT_TABLE: studentTable.tableName,
    SEND_SMS_FUNCTION_NAME: sendSmsFn.functionName,
  },
});

attendanceTable.grantReadData(checkThresholdFn);
checkThresholdFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${attendanceTable.tableArn}/index/*`],
}));

studentTable.grantReadData(checkThresholdFn);

notificationTable.grantReadData(checkThresholdFn);
checkThresholdFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${notificationTable.tableArn}/index/*`],
}));

sendSmsFn.grantInvoke(checkThresholdFn);

// New EventBridge rule: only ABSENT AttendanceRecorded events, routed to
// checkThresholdFn. Separate from AttendanceAuditRule (which logs every
// outcome) -- this one only cares about absences worth evaluating.
new events.Rule(this, 'ThresholdCheckRule', {
  eventBus: defaultBus,
  eventPattern: {
    source: ['csg.attendance'],
    detailType: ['AttendanceRecorded'],
    detail: {
      status: ['ABSENT'],
    },
  },
  targets: [new targets.LambdaFunction(checkThresholdFn)],
});

// ---- predictAttendanceRisk function (Phase D) ----
// Scores a student's forward-looking attendance risk using a logistic
// regression trained offline (infra/scripts/train-risk-model/). Coefficients
// are bundled as a JSON file alongside the handler -- no sklearn/Python
// runtime needed in Lambda, just plain arithmetic re-implementing the model.
const predictAttendanceRiskFn = new lambda.Function(this, 'PredictAttendanceRiskFunction', {
  functionName: 'predictAttendanceRiskFunction',
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  timeout: cdk.Duration.seconds(15),
  code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/predictAttendanceRisk')),
  environment: {
    ATTENDANCE_TABLE: attendanceTable.tableName,
  },
});

attendanceTable.grantReadData(predictAttendanceRiskFn);
predictAttendanceRiskFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${attendanceTable.tableArn}/index/*`],
}));

    attendanceTable.grantReadData(attendanceSummaryFn);

    studentTable.grantReadData(attendanceSummaryFn);
    attendanceSummaryFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${attendanceTable.tableArn}/index/*`, `${studentTable.tableArn}/index/*`],
    }));

    // Claude Haiku 4.5 via the EU cross-region inference profile -- both the
    // profile ARN and every underlying regional model ARN it can route to
    // need InvokeModel permission, since Bedrock checks both.
    attendanceSummaryFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        'arn:aws:bedrock:eu-north-1:747856054044:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-north-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-south-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-south-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        'arn:aws:bedrock:eu-west-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        
      ],
      
    }));
    attendanceSummaryFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'aws-marketplace:ViewSubscriptions',
    'aws-marketplace:Subscribe',
  ],
  resources: ['*'], // AWS requires '*' for these specific Marketplace actions — scoping to an ARN isn't supported
}));

    // ---- GraphQL API ----
    this.api = new AmplifyGraphqlApi(this, 'AttendanceApi', {
      definition: AmplifyGraphqlDefinition.fromFiles(
        path.join(__dirname, '../../graphql/schema/schema.graphql')
      ),
      authorizationModes: {
        defaultAuthorizationMode: 'AMAZON_COGNITO_USER_POOLS',
        userPoolConfig: { userPool: props.userPool },
      },
            functionNameMap: {
          markAttendanceFunction: markAttendanceFn,
          attendanceSummaryFunction: attendanceSummaryFn,
         sendSmsFunction: sendSmsFn,
         predictAttendanceRiskFunction: predictAttendanceRiskFn,
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
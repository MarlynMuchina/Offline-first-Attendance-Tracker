import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

/**
 * AnalyticsStack — curated data export pipeline (issue #27).
 *
 * Per the CSG framework's recommended CDK layout (Volume 3, Section 6),
 * analytics concerns get their own stack rather than living inside
 * api_stack.ts. This stack exports a daily CSV snapshot of attendance data
 * (denormalized with student/class names) to S3, ready to be picked up by
 * QuickSight once that's subscribed to (deliberately deferred -- see issue
 * #27 comments on the Nov 23-Dec 1 demo timing constraint).
 */
export class AnalyticsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const exportBucket = new s3.Bucket(this, 'AttendanceExportBucket', {
      bucketName: `csg-attendance-exports-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never auto-delete exported data
      lifecycleRules: [{
        // Keep storage costs at zero-ish -- exports are small, but this
        // caps growth over a multi-year deployment.
        expiration: cdk.Duration.days(365),
      }],
    });

    const attendanceTable = dynamodb.Table.fromTableName(
      this, 'AnalyticsAttendanceTable', 'AttendanceRecord-wtgwzva7hvcrljtyfsbjgqiora-NONE'
    );
    const studentTable = dynamodb.Table.fromTableName(
      this, 'AnalyticsStudentTable', 'Student-wtgwzva7hvcrljtyfsbjgqiora-NONE'
    );
    const classTable = dynamodb.Table.fromTableName(
      this, 'AnalyticsClassTable', 'Class-wtgwzva7hvcrljtyfsbjgqiora-NONE'
    );

    const exportFn = new lambda.Function(this, 'ExportAttendanceDataFunction', {
      functionName: 'exportAttendanceDataFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(60),
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/exportAttendanceData')),
      environment: {
        ATTENDANCE_TABLE: attendanceTable.tableName,
        STUDENT_TABLE: studentTable.tableName,
        CLASS_TABLE: classTable.tableName,
        EXPORT_BUCKET: exportBucket.bucketName,
        SCHOOL_ID: 'school-001', // TODO: multi-school once Admin module exists
      },
    });

    attendanceTable.grantReadData(exportFn);
    studentTable.grantReadData(exportFn);
    classTable.grantReadData(exportFn);
    exportFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        `${attendanceTable.tableArn}/index/*`,
        `${studentTable.tableArn}/index/*`,
        `${classTable.tableArn}/index/*`,
      ],
    }));
    exportBucket.grantWrite(exportFn);

    // Daily at 02:00 UTC -- off-hours for a Kenya-based school, low traffic.
    new events.Rule(this, 'DailyExportSchedule', {
      schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
      targets: [new targets.LambdaFunction(exportFn)],
    });

    new cdk.CfnOutput(this, 'ExportBucketName', { value: exportBucket.bucketName });
  }
}
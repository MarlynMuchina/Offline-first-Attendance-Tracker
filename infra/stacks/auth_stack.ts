import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

/**
 * AuthStack — Cognito user pool + role groups.
 *
 * Groups mirror the CSG platform authorization matrix (Engineering Framework
 * Vol. 2, Section 4) for the Attendance module's relevant roles:
 *   - Admin           (Full access)
 *   - HeadTeacher      (Full access)
 *   - Teacher          (Assigned classes only)
 *   - Parent           (Own student's alerts/history only)
 *
 * Role permissions themselves are enforced in Lambda resolvers, not by group
 * membership alone (Vol. 2, Section 2.5: "AppSync directives can help, but
 * backend validation is still required").
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'AttendanceUserPool', {
      userPoolName: 'csg-attendance-user-pool',
      selfSignUpEnabled: false, // accounts provisioned by admin, not public signup
      signInAliases: { email: true, phone: true },
      autoVerify: { email: true },
      standardAttributes: {
        phoneNumber: { required: false, mutable: true },
      },
      customAttributes: {
        // used by Lambda resolvers to enforce the school_id tenant boundary
        // (CSG platform standard: every request validated against school_id)
        school_id: new cognito.StringAttribute({ mutable: false }),
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // interim account only — tighten before Angaza handoff
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'AttendanceUserPoolClient', {
      userPool: this.userPool,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false, // public client (web PWA)
    });

    const groups = ['Admin', 'HeadTeacher', 'Teacher', 'Parent'];
    groups.forEach((groupName) => {
      new cognito.CfnUserPoolGroup(this, `${groupName}Group`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
        description: `${groupName} role group — permissions enforced in Lambda resolvers`,
      });
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}

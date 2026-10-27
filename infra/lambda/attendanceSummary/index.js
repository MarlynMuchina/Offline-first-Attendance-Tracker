const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);
const bedrock = new BedrockRuntimeClient({});
const cognito = new CognitoIdentityProviderClient({});

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;
const STUDENT_TABLE = process.env.STUDENT_TABLE;
const USER_POOL_ID = process.env.USER_POOL_ID;
// Claude Haiku 4.5 via the EU cross-region inference profile -- confirmed
// via `aws bedrock list-inference-profiles`, since this account's Bedrock
// models require inference profiles rather than direct on-demand invocation.
// EU-scoped (not Global) to keep inference traffic within Europe.
const MODEL_ID = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

// AppSync signs calls with the access token, which carries the groups but
// not custom:school_id, so the caller's school is read from Cognito. It
// never changes, so it's kept while the Lambda stays warm. The school in a
// request is never trusted on its own (CSG Vol 2, sec 2.5).
const callerSchools = new Map();

async function getCallerSchool(identity) {
  const fromToken = identity?.claims?.['custom:school_id'];
  if (fromToken) return fromToken;
  const username = identity?.username;
  if (!username) throw new Error('Not signed in.');
  if (!callerSchools.has(username)) {
    const lookup = cognito
      .send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
      .then((user) => (user.UserAttributes || []).find((a) => a.Name === 'custom:school_id')?.Value || null);
    callerSchools.set(username, lookup);
    lookup.catch(() => callerSchools.delete(username));
  }
  const schoolId = await callerSchools.get(username);
  if (!schoolId) throw new Error('This account has no school.');
  return schoolId;
}

async function assertCallerSchool(identity, schoolId) {
  if ((await getCallerSchool(identity)) !== schoolId) {
    throw new Error("You can only work with your own school's data.");
  }
}

exports.handler = async (event) => {
  const { school_id, class_id, start_date, end_date } = event.arguments.input;
  await assertCallerSchool(event.identity, school_id);

  // 1. Pull the class roster (for names, not raw PII beyond what's needed)
  const students = await doc.send(new QueryCommand({
    TableName: STUDENT_TABLE,
    IndexName: 'byClass',
    KeyConditionExpression: 'class_id = :cid',
    ExpressionAttributeValues: { ':cid': class_id },
  }));

  // 2. Pull attendance records for the date range
  const records = await doc.send(new QueryCommand({
    TableName: ATTENDANCE_TABLE,
    IndexName: 'byClassDate',
    KeyConditionExpression: 'class_id = :cid AND #d BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':cid': class_id, ':start': start_date, ':end': end_date },
  }));

  // 3. Aggregate -- curated stats only, not raw daily rows, per CSG platform
  // standard ("no heavy reporting workloads query raw data directly", and
  // "prompts must avoid exposing sensitive data unnecessarily").
  const statsByStudent = {};
  // Only this school's students, so another school's class id gives nothing away.
  for (const s of students.Items || []) {
    if (s.school_id !== school_id) continue;
    statsByStudent[s.id] = { name: `${s.first_name} ${s.last_name}`, present: 0, absent: 0, late: 0, total: 0 };
  }
  for (const r of records.Items || []) {
    const stat = statsByStudent[r.student_id];
    if (!stat) continue;
    stat.total += 1;
    if (r.status === 'PRESENT') stat.present += 1;
    if (r.status === 'ABSENT') stat.absent += 1;
    if (r.status === 'LATE') stat.late += 1;
  }

  const summaryRows = Object.values(statsByStudent).map((s) => ({
    name: s.name,
    // Late counts as attended, the same as on the dashboard, in the SMS alerts
    // and in the risk model.
    attendance_rate: s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 100) : null,
    absences: s.absent,
    lates: s.late,
  }));

  const belowThreshold = summaryRows.filter((s) => s.attendance_rate !== null && s.attendance_rate < 70);

  // 4. Prompt -- follows the CSG prompt template structure: role, allowed
  // input, forbidden inferences, output format, audience (Vol 2, Section 8.1)
  const prompt = `You are an analytics assistant for Angaza Center's ConnectED School Grid.
Use only the provided dataset summary below.
Do not infer sensitive personal facts not supported by the data.
Audience: school leader

Dataset (${start_date} to ${end_date}):
${JSON.stringify(summaryRows, null, 2)}

Students below 70% attendance: ${belowThreshold.length > 0 ? JSON.stringify(belowThreshold) : 'none'}

Output format:
1. Summary
2. Key trends
3. Risks
4. Recommended actions`;

  const response = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const summaryText = responseBody.content[0].text;

  return {
    summary: summaryText,
    generated_at: new Date().toISOString(),
  };
};
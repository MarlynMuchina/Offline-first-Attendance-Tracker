/**
 * predictAttendanceRisk/index.js — Phase D
 *
 * Scores a student's risk of falling below 70% attendance using a logistic
 * regression trained offline (see infra/scripts/train-risk-model/). This
 * Lambda does NOT run scikit-learn or bundle a Python runtime -- it
 * reimplements the fitted model as a plain sigmoid over a linear
 * combination of standardized features, using the coefficients/scaler
 * exported by the training script into model_coefficients.json.
 *
 * IMPORTANT -- this predicts the SAME 70%-threshold outcome as the static
 * checkThreshold Lambda, but does so from EARLIER data than checkThreshold
 * sees: checkThreshold reacts to an absence that already happened this
 * month; this function estimates risk going into the rest of the term from
 * attendance trend so far. They are complementary, not redundant -- one is
 * reactive (issue #35), this one is a forward-looking estimate (Phase D).
 *
 * Query shape (see schema.graphql PredictAttendanceRiskInput):
 *   input: { student_id: ID! }
 * Computes features from ALL attendance records on file for that student
 * up to "now" (no held-out label window at inference time -- the temporal
 * split only applies to how the model was TRAINED, not to how it's used).
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const model = require('./model_coefficients.json');

const client = new DynamoDBClient({});
const doc = DynamoDBDocumentClient.from(client);

const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;

// NOTE: checks UPPERCASE values because this Lambda reads from DynamoDB,
// where markAttendance enforces uppercase status at write time. The
// offline training script (infra/scripts/train-risk-model/train_risk_model.py)
// checks Title-case values ("Present"/"Late") because it reads the raw CSV
// export directly. This is a real, intentional difference between the two
// -- do not "fix" one to match the other without checking its actual
// data source. See infra/scripts/drift-check/ for the test that guards
// against the two feature implementations silently diverging.
function isAttended(status) {
  return status === 'PRESENT' || status === 'LATE';
}

/**
 * Mirrors compute_features() in train_risk_model.py exactly. If you change
 * one, change the other -- there is no shared source of truth between the
 * Python training code and this JS scoring code, which is the real cost of
 * not shipping sklearn to Lambda. Keep them in lockstep by hand.
 */
function computeFeatures(recordsSortedAsc) {
  const total = recordsSortedAsc.length;
  if (total === 0) return null;

  const present = recordsSortedAsc.filter((r) => isAttended(r.status)).length;
  const overallRate = present / total;

  const last7 = recordsSortedAsc.slice(-7);
  const last14 = recordsSortedAsc.slice(-14);
  const recent7Rate = last7.filter((r) => isAttended(r.status)).length / last7.length;
  const recent14Rate = last14.filter((r) => isAttended(r.status)).length / last14.length;

  const trend = recent14Rate - overallRate;

  let maxStreak = 0;
  let curStreak = 0;
  for (const r of recordsSortedAsc) {
    if (r.status === 'ABSENT') {
      curStreak++;
      maxStreak = Math.max(maxStreak, curStreak);
    } else {
      curStreak = 0;
    }
  }

  let activeStreak = 0;
  for (let i = recordsSortedAsc.length - 1; i >= 0; i--) {
    if (recordsSortedAsc[i].status === 'ABSENT') {
      activeStreak++;
    } else {
      break;
    }
  }

  return {
    overall_rate: overallRate,
    recent7_rate: recent7Rate,
    recent14_rate: recent14Rate,
    trend_recent14_minus_overall: trend,
    max_absence_streak: maxStreak,
    active_absence_streak_at_cutoff: activeStreak,
  };
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function scoreFeatures(features) {
  const { feature_names, scaler_mean, scaler_scale, coefficients, intercept } = model;

  let z = intercept;
  for (let i = 0; i < feature_names.length; i++) {
    const raw = features[feature_names[i]];
    const standardized = (raw - scaler_mean[i]) / scaler_scale[i];
    z += coefficients[i] * standardized;
  }

  return sigmoid(z);
}

exports.handler = async (event) => {
  const input = event.arguments?.input ?? event;
  const { student_id } = input;

  if (!student_id) {
    throw new Error('student_id is required');
  }

  // Single-key GSI query, consistent with every other Lambda in this
  // codebase -- byStudent only has student_id as its key attribute.
  const res = await doc.send(new QueryCommand({
    TableName: ATTENDANCE_TABLE,
    IndexName: 'byStudent',
    KeyConditionExpression: 'student_id = :sid',
    ExpressionAttributeValues: { ':sid': student_id },
  }));

  const records = (res.Items || []).sort((a, b) => a.date.localeCompare(b.date));
  const features = computeFeatures(records);

  if (!features) {
    return {
      student_id,
      risk_score: null,
      risk_level: 'UNKNOWN',
      reason: 'No attendance records found for this student',
      model_trained_at: model.training_metadata.trained_at,
    };
  }

  const riskScore = scoreFeatures(features);

  // Thresholds are a judgment call, not part of the fitted model -- chosen
  // to give a MEDIUM band rather than a single cliff-edge cutoff, since a
  // binary flag right at 0.5 would be harder to explain to a non-technical
  // admin than a three-tier label.
  let riskLevel;
  if (riskScore >= 0.6) riskLevel = 'HIGH';
  else if (riskScore >= 0.3) riskLevel = 'MEDIUM';
  else riskLevel = 'LOW';

  const trendDirection = features.trend_recent14_minus_overall < -0.05
    ? 'declining'
    : features.trend_recent14_minus_overall > 0.05
      ? 'improving'
      : 'stable';

  return {
    student_id,
    risk_score: Math.round(riskScore * 1000) / 1000,
    risk_level: riskLevel,
    reason: `Recent-14-day attendance is ${trendDirection} relative to term average `
      + `(${Math.round(features.recent14_rate * 100)}% recent vs ${Math.round(features.overall_rate * 100)}% overall).`,
    features,
    model_trained_at: model.training_metadata.trained_at,
  };
};
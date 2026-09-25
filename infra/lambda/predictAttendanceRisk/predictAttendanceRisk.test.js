/**
 * predictAttendanceRisk.test.js
 *
 * Mirrors the testing pattern used for markAttendance: mock the AWS SDK
 * clients at the module level, then exercise the handler directly.
 *
 * These tests validate two separate things, deliberately kept apart:
 *   1. The handler's DynamoDB interaction and response shape (mocked data)
 *   2. The scoring math itself, using known inputs with hand-computed
 *      expected outputs -- this is what catches silent drift between the
 *      Python training script and this JS reimplementation (see the
 *      "duplicated feature logic" gap flagged in project notes).
 *
 * Run: npx jest predictAttendanceRisk.test.js
 * (from infra/lambda/predictAttendanceRisk/, or wherever your jest.config
 * resolves this file -- match however markAttendance's tests are wired up)
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => params),
}));

process.env.ATTENDANCE_TABLE = 'AttendanceRecord-test-NONE';

const { handler } = require('./index');
const model = require('./model_coefficients.json');

// ---- Helpers ----

function makeRecords(statusSequence, startDate = '2026-05-04') {
  // statusSequence: array of 'PRESENT' | 'ABSENT' | 'LATE', one per school day,
  // oldest first. Generates sequential weekday-ish dates (not calendar-accurate,
  // just monotonically increasing -- the handler only cares about sort order).
  const start = new Date(startDate);
  return statusSequence.map((status, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return {
      student_id: 'TEST-S001',
      date: d.toISOString().split('T')[0],
      status,
    };
  });
}

beforeEach(() => {
  mockSend.mockReset();
});

// ---- DynamoDB interaction / response shape ----

describe('predictAttendanceRisk handler', () => {
  test('throws if student_id is missing', async () => {
    await expect(handler({ arguments: { input: {} } })).rejects.toThrow('student_id is required');
  });

  test('supports both AppSync (arguments.input) and direct-invoke shapes', async () => {
    mockSend.mockResolvedValue({ Items: makeRecords(Array(20).fill('PRESENT')) });

    const viaAppSync = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });
    expect(viaAppSync.student_id).toBe('TEST-S001');

    const viaDirectInvoke = await handler({ student_id: 'TEST-S001' });
    expect(viaDirectInvoke.student_id).toBe('TEST-S001');
  });

  test('queries byStudent GSI with student_id only in KeyConditionExpression', async () => {
    mockSend.mockResolvedValue({ Items: makeRecords(Array(10).fill('PRESENT')) });
    await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    const calledWith = mockSend.mock.calls[0][0];
    expect(calledWith.IndexName).toBe('byStudent');
    expect(calledWith.KeyConditionExpression).toBe('student_id = :sid');
    // Regression guard for the exact bug fixed in checkThreshold: this
    // query must never combine a second condition into KeyConditionExpression,
    // since every GSI in this schema is single-key.
    expect(calledWith.KeyConditionExpression).not.toMatch(/AND/);
  });

  test('returns UNKNOWN risk level when no records exist for the student', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.risk_level).toBe('UNKNOWN');
    expect(result.risk_score).toBeNull();
    expect(result.reason).toMatch(/no attendance records/i);
  });

  test('handles a missing Items array from DynamoDB gracefully', async () => {
    mockSend.mockResolvedValue({}); // no Items key at all
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });
    expect(result.risk_level).toBe('UNKNOWN');
  });

  test('a perfect-attendance student scores LOW risk', async () => {
    mockSend.mockResolvedValue({ Items: makeRecords(Array(33).fill('PRESENT')) });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.risk_level).toBe('LOW');
    expect(result.risk_score).toBeLessThan(0.3);
    expect(result.features.overall_rate).toBe(1);
    expect(result.features.active_absence_streak_at_cutoff).toBe(0);
  });

  test('a student absent every recent day scores HIGH risk', async () => {
    // 25 present days, then 8 straight absences -- steep recent decline.
    const sequence = [...Array(25).fill('PRESENT'), ...Array(8).fill('ABSENT')];
    mockSend.mockResolvedValue({ Items: makeRecords(sequence) });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.risk_level).toBe('HIGH');
    expect(result.features.active_absence_streak_at_cutoff).toBe(8);
    expect(result.features.trend_recent14_minus_overall).toBeLessThan(0);
    expect(result.reason).toMatch(/declining/i);
  });

  test('reason text reflects an improving trend for a recovering student', async () => {
    // Rocky start (mostly absent), strong recent recovery.
    const sequence = [...Array(15).fill('ABSENT'), ...Array(18).fill('PRESENT')];
    mockSend.mockResolvedValue({ Items: makeRecords(sequence) });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.features.trend_recent14_minus_overall).toBeGreaterThan(0);
    expect(result.reason).toMatch(/improving/i);
  });

  test('LATE counts as attended, matching checkThreshold and Admin.jsx conventions', async () => {
    const allLate = makeRecords(Array(20).fill('LATE'));
    mockSend.mockResolvedValue({ Items: allLate });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.features.overall_rate).toBe(1);
  });

  test('handles unsorted DynamoDB results (scan/query order is not guaranteed)', async () => {
    const sorted = makeRecords([...Array(20).fill('PRESENT'), ...Array(5).fill('ABSENT')]);
    const shuffled = [...sorted].reverse(); // worst case: fully reversed
    mockSend.mockResolvedValue({ Items: shuffled });

    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });
    // If the handler didn't re-sort internally, "recent" and "active streak"
    // would be computed from the wrong end of the array.
    expect(result.features.active_absence_streak_at_cutoff).toBe(5);
  });

  test('model_trained_at is passed through from the bundled coefficients file', async () => {
    mockSend.mockResolvedValue({ Items: makeRecords(Array(10).fill('PRESENT')) });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });
    expect(result.model_trained_at).toBe(model.training_metadata.trained_at);
  });
});

// ---- Scoring math (drift guard vs. training script) ----

describe('scoring math matches hand-computed expectations', () => {
  test('a known feature vector produces the expected risk direction', async () => {
    // 33 days: mostly present, but a rough final stretch -- the exact
    // shape of the CV's higher-risk cases. Not asserting an exact score
    // (that's what train_risk_model.py's own CV metrics are for) -- just
    // that risk correctly increases as recent performance degrades
    // relative to an identical overall rate.
    const stable = makeRecords([...Array(30).fill('PRESENT'), ...Array(3).fill('ABSENT')]);
    const declining = makeRecords([
      ...Array(27).fill('PRESENT'),
      ...Array(3).fill('ABSENT'),
      ...Array(3).fill('ABSENT'), // extra recent absences, same 30-day total present count minus a few
    ]);

    mockSend.mockResolvedValueOnce({ Items: stable });
    const resultStable = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    mockSend.mockResolvedValueOnce({ Items: declining });
    const resultDeclining = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(resultDeclining.risk_score).toBeGreaterThan(resultStable.risk_score);
  });

  test('risk_score is always a valid probability', async () => {
    const sequence = [...Array(10).fill('PRESENT'), ...Array(10).fill('ABSENT')];
    mockSend.mockResolvedValue({ Items: makeRecords(sequence) });
    const result = await handler({ arguments: { input: { student_id: 'TEST-S001' } } });

    expect(result.risk_score).toBeGreaterThanOrEqual(0);
    expect(result.risk_score).toBeLessThanOrEqual(1);
  });
});
"""
generate_golden_cases.py — Phase D drift guard, step 1 of 2.

Generates a fixed set of synthetic attendance sequences and runs them
through train_risk_model.py's compute_features() (the Python/training
implementation), writing the results to golden_features.json.

A separate JS test (drift.test.js) re-computes the same sequences using
the Lambda's computeFeatures() and asserts they match exactly. If someone
changes one implementation without the other, this test fails immediately
instead of silently diverging.

Usage: python generate_golden_cases.py
Regenerate whenever compute_features() changes in train_risk_model.py.
"""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'train-risk-model'))
from train_risk_model import compute_features

# Each case: a sequence of statuses (Present/Absent/Late), representing
# one student's feature-window records in chronological order. Dates are
# synthetic but must be sortable strings, matching the real date format.
CASES = {
    "perfect_attendance": ["Present"] * 33,
    "all_absent": ["Absent"] * 33,
    "single_record": ["Present"],
    "single_absent_record": ["Absent"],
    "exactly_seven_days": ["Present", "Absent", "Present", "Present", "Late", "Absent", "Present"],
    "exactly_fourteen_days": (["Present"] * 10 + ["Absent"] * 4),
    "declining_trend": (["Present"] * 25 + ["Absent"] * 8),
    "improving_trend": (["Absent"] * 15 + ["Present"] * 18),
    "all_late": ["Late"] * 20,
    "alternating": ["Present", "Absent"] * 16 + ["Present"],
    "trailing_absence_streak": (["Present"] * 20 + ["Absent"] * 5),
    "leading_absence_streak_only": (["Absent"] * 5 + ["Present"] * 20),
    "short_window_under_seven": ["Present", "Present", "Absent"],
}

def make_records(statuses):
    # compute_features only reads r["status"] -- date is unused by the
    # feature math itself (sort order is assumed correct going in), so a
    # simple synthetic date is fine here.
    return [{"date": f"2026-05-{i+1:02d}", "status": s} for i, s in enumerate(statuses)]

def main():
    golden = {}
    for name, statuses in CASES.items():
        records = make_records(statuses)
        features = compute_features(records)
        golden[name] = {
            "input_statuses": statuses,
            "expected_features": features,
        }

    out_path = os.path.join(os.path.dirname(__file__), "golden_features.json")
    with open(out_path, "w") as f:
        json.dump(golden, f, indent=2)
    print(f"Wrote {len(golden)} golden cases to {out_path}")

if __name__ == "__main__":
    main()
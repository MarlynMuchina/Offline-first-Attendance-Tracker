"""
train_risk_model.py — CSG Attendance Risk Predictor (Phase D)

Trains a logistic regression to predict whether a student will fall below
70% attendance in a LATER window, using only features computed from an
EARLIER window. This temporal split is the whole point: it's what makes
this a genuine prediction task rather than re-deriving a threshold from
the same aggregate stat used to define it (the trap with the aggregated
CSV — see project notes).

Feature window: 2026-05-04 to 2026-06-19 (33 school days)
Label window:   2026-06-22 to 2026-07-10 (15 school days)

Output: model_coefficients.json — feature names, scaler mean/std, logistic
regression coefficients + intercept. This is deliberately NOT a pickled
sklearn model — it's re-implemented as a plain sigmoid-over-linear-
combination in the Lambda (Node.js), so no Python runtime needs to ship
to Lambda for four numbers and a scaler.

Usage:
    python train_risk_model.py CSG_Attendance_Daily_Normalized.csv
"""
import sys
import os
import json
import csv
from collections import defaultdict
from datetime import datetime

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    roc_auc_score, precision_score, recall_score, f1_score,
    confusion_matrix, classification_report,
)

FEATURE_END = "2026-06-19"
LABEL_START = "2026-06-22"

FEATURE_NAMES = [
    "overall_rate",
    "recent7_rate",
    "recent14_rate",
    "trend_recent14_minus_overall",
    "max_absence_streak",
    "active_absence_streak_at_cutoff",
]


def load_records(path):
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_student = defaultdict(list)
    for r in rows:
        by_student[r["student_id"]].append(r)
    for sid in by_student:
        by_student[sid].sort(key=lambda r: r["date"])
    return by_student


def is_attended(status):
    # NOTE: this checks Title-case values ("Present"/"Late") because this
    # script reads the raw CSG_Attendance_Daily_Normalized.csv export
    # directly. The production Lambda (infra/lambda/predictAttendanceRisk/
    # index.js) checks UPPERCASE values ("PRESENT"/"LATE") because it reads
    # from DynamoDB, where markAttendance enforces uppercase at write time.
    # This is a real, intentional difference -- do not "fix" one to match
    # the other without checking what data source it actually reads.
    return status in ("Present", "Late")


def compute_features(records_in_window):
    """records_in_window: this student's rows with date <= FEATURE_END, sorted ascending."""
    total = len(records_in_window)
    if total == 0:
        # No data in feature window for this student — shouldn't happen with
        # this dataset (all students have full 48-day records), but guard anyway.
        return None

    present = sum(1 for r in records_in_window if is_attended(r["status"]))
    overall_rate = present / total

    last7 = records_in_window[-7:]
    last14 = records_in_window[-14:]
    recent7_rate = sum(1 for r in last7 if is_attended(r["status"])) / len(last7)
    recent14_rate = sum(1 for r in last14 if is_attended(r["status"])) / len(last14)

    trend = recent14_rate - overall_rate

    # Longest absence streak anywhere in the feature window
    max_streak = 0
    cur_streak = 0
    for r in records_in_window:
        if r["status"] == "Absent":
            cur_streak += 1
            max_streak = max(max_streak, cur_streak)
        else:
            cur_streak = 0

    # Absence streak still "active" as of the cutoff (walking backward from the end)
    active_streak = 0
    for r in reversed(records_in_window):
        if r["status"] == "Absent":
            active_streak += 1
        else:
            break

    return {
        "overall_rate": overall_rate,
        "recent7_rate": recent7_rate,
        "recent14_rate": recent14_rate,
        "trend_recent14_minus_overall": trend,
        "max_absence_streak": max_streak,
        "active_absence_streak_at_cutoff": active_streak,
    }


def compute_label(records_after_cutoff):
    total = len(records_after_cutoff)
    if total == 0:
        return None
    present = sum(1 for r in records_after_cutoff if is_attended(r["status"]))
    rate = present / total
    return 1 if rate < 0.70 else 0


def build_dataset(by_student):
    X_rows = []
    y = []
    student_ids = []
    for sid, recs in by_student.items():
        feature_recs = [r for r in recs if r["date"] <= FEATURE_END]
        label_recs = [r for r in recs if r["date"] >= LABEL_START]

        feats = compute_features(feature_recs)
        label = compute_label(label_recs)
        if feats is None or label is None:
            continue

        X_rows.append([feats[name] for name in FEATURE_NAMES])
        y.append(label)
        student_ids.append(sid)

    return np.array(X_rows, dtype=float), np.array(y, dtype=int), student_ids


def main():
    if len(sys.argv) != 2:
        print("Usage: python train_risk_model.py <daily_normalized_csv>")
        sys.exit(1)

    by_student = load_records(sys.argv[1])
    X, y, student_ids = build_dataset(by_student)

    print(f"Dataset: {X.shape[0]} students, {X.shape[1]} features")
    print(f"Positive class (at-risk, label window < 70%): {y.sum()} ({y.mean()*100:.1f}%)")
    print()

    # ---- Standardize features ----
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ---- Stratified 5-fold cross-validation (honest evaluation given small n) ----
    # NOT a single train/test split -- with only ~14 positives, one split could
    # by chance put most of them in either train or test. Cross-validated
    # out-of-fold predictions give a much more honest picture.
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    clf_cv = LogisticRegression(class_weight="balanced", max_iter=1000)
    y_pred_cv = cross_val_predict(clf_cv, X_scaled, y, cv=skf, method="predict")
    y_proba_cv = cross_val_predict(clf_cv, X_scaled, y, cv=skf, method="predict_proba")[:, 1]

    print("=== Cross-validated evaluation (5-fold stratified) ===")
    print(f"ROC-AUC:   {roc_auc_score(y, y_proba_cv):.3f}")
    print(f"Precision: {precision_score(y, y_pred_cv, zero_division=0):.3f}")
    print(f"Recall:    {recall_score(y, y_pred_cv, zero_division=0):.3f}")
    print(f"F1:        {f1_score(y, y_pred_cv, zero_division=0):.3f}")
    print()
    print("Confusion matrix (rows=actual, cols=predicted, [0,1]):")
    print(confusion_matrix(y, y_pred_cv))
    print()
    print(classification_report(y, y_pred_cv, target_names=["not at risk", "at risk"], zero_division=0))

    # ---- Fit final model on ALL data for deployment ----
    # (cross-validation above is for honest performance reporting only;
    # the deployed model uses every available student for the best estimate.)
    final_clf = LogisticRegression(class_weight="balanced", max_iter=1000)
    final_clf.fit(X_scaled, y)

    trained_at = datetime.utcnow().isoformat() + "Z"
    # Version string is just the training timestamp, filesystem-safe.
    # Not semantic versioning -- there's no meaningful "major/minor" bump
    # for a single logistic regression retrained on more data. The
    # timestamp IS the meaningful identity of a given model artifact here.
    model_version = trained_at.replace(":", "").replace("-", "").replace(".", "")

    output = {
        "feature_names": FEATURE_NAMES,
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "coefficients": final_clf.coef_[0].tolist(),
        "intercept": float(final_clf.intercept_[0]),
        "training_metadata": {
            "model_version": model_version,
            "trained_at": trained_at,
            "n_students": int(X.shape[0]),
            "n_positive": int(y.sum()),
            "feature_window": ["2026-05-04", FEATURE_END],
            "label_window": [LABEL_START, "2026-07-10"],
            "cv_roc_auc": round(float(roc_auc_score(y, y_proba_cv)), 3),
            "cv_precision": round(float(precision_score(y, y_pred_cv, zero_division=0)), 3),
            "cv_recall": round(float(recall_score(y, y_pred_cv, zero_division=0)), 3),
        },
    }

    # ---- Archive the previous deployed model before overwriting it ----
    # model_coefficients.json is the single canonical file the Lambda
    # bundles and reads (index.js does require('./model_coefficients.json')
    # -- it has no version-selection logic, by design, to keep the Lambda
    # simple). Retraining without this archive step would silently lose
    # the previous model's coefficients and CV metrics with no way to
    # compare "did this retrain actually improve anything" or roll back.
    output_path = "model_coefficients.json"
    if os.path.exists(output_path):
        with open(output_path) as f:
            previous = json.load(f)
        previous_version = previous.get("training_metadata", {}).get("model_version", "unversioned")

        archive_dir = "model_versions"
        os.makedirs(archive_dir, exist_ok=True)
        archive_path = os.path.join(archive_dir, f"model_coefficients_{previous_version}.json")
        with open(archive_path, "w") as f:
            json.dump(previous, f, indent=2)
        print(f"Archived previous model ({previous_version}) to {archive_path}")

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {output_path} (model_version: {model_version})")


if __name__ == "__main__":
    main()
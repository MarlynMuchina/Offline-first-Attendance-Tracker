"""
Exports the full AttendanceRecord table from DynamoDB to a flat CSV,
handling pagination (scan only returns up to 1MB per call) and
flattening DynamoDB's typed JSON format ({"S": "value"}) into plain values.

Usage (PowerShell, from repo root or anywhere with AWS creds configured):
    python export_attendance.py

Requires: boto3 (pip install boto3 --break-system-packages, or just boto3
in whatever venv you already use for this project)
"""
import boto3
import csv

TABLE_NAME = "AttendanceRecord-wtgwzva7hvcrljtyfsbjgqiora-NONE"
REGION = "eu-north-1"
OUTPUT_FILE = "attendance_raw_export.csv"

FIELDS = [
    "id", "school_id", "student_id", "class_id", "date", "status",
    "reason_code", "marked_by", "marked_at", "created_at", "updated_at",
    "client_request_id",
]

def scan_all_items():
    client = boto3.client("dynamodb", region_name=REGION)
    items = []
    kwargs = {"TableName": TABLE_NAME}
    while True:
        resp = client.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        print(f"  ...{len(items)} items so far")
    return items

def flatten(item):
    row = {}
    for field in FIELDS:
        val = item.get(field)
        if val is None:
            row[field] = ""
        else:
            # DynamoDB typed value, e.g. {"S": "foo"} or {"N": "123"}
            (_, v), = val.items()
            row[field] = v
    return row

def main():
    print(f"Scanning {TABLE_NAME} in {REGION}...")
    items = scan_all_items()
    print(f"Total items retrieved: {len(items)}")

    rows = [flatten(item) for item in items]

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
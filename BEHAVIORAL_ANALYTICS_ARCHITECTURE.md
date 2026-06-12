# Behavioral Analytics — Implementation Plan

**Feature:** Document Behavioral Analytics for HRMS
**Status:** Proposed — Pending Lead Review

---

## Overview

The HRMS document library currently has no insight into how employees interact with documents. This feature adds a silent, non-intrusive behavioural analysis layer — it logs document access patterns per employee, detects anomalies, and notifies HR when something worth a conversation is detected.

The employee never knows this is happening. No document content is ever read. Only access metadata is used. HR uses the signal to initiate a natural, human-led conversation.

---

## Signal Categories & Thresholds

Documents are tagged with a category. The category determines the threshold and recommended HR action.

| Category | Example Documents | Default Threshold | Window | HR Action |
|---|---|---|---|---|
| `SENSITIVE` | POSH policy, Grievance policy | 3 opens | 7 days | Confidential 1-on-1 check-in |
| `LEAVE_INTENT` | Holiday List, Leave Policy | 5 opens | 7 days | Nudge to apply leave |
| `EXIT_INTENT` | Resignation process, F&F settlement | 2 opens | 7 days | Retention conversation |
| `GROWTH` | Appraisal form, Promotion policy | 4 opens | 7 days | Manager prep conversation |
| `GENERAL` | Employee handbook, WFH policy | not tracked | — | No alert |

All thresholds are environment variables — tunable without code changes.

---

## Workflow

```
Employee opens doc
       ↓
Access logged silently (non-blocking — employee sees no difference)
       ↓
Pattern engine checks: how many times has this employee opened
this document category in the last 7 days?
       ↓
Below threshold → nothing happens, log stored, wait for next access
       ↓
Above threshold → signal scored → BehaviorAlert created
       ↓
HR gets in-app notification (existing bell) + email
       ↓
HR reviews in HRPanel → Signals tab
       ↓
HR has a natural conversation with the employee
       ↓
HR marks alert resolved
       ↓
Logging continues — if pattern repeats, a new alert fires
```

**What is NOT happening:**
- Document content is never read
- No automated action is ever taken — the system only informs HR
- Employees are never told they triggered an alert
- A single document open never fires an alert — only repeated patterns do

---

## File Structure

```
backend/
├── enums/
│   └── document_category.py        # DocumentCategory enum
├── database/models/
│   ├── document_access_log.py      # Stores every document access event
│   └── behavior_alert.py           # Stores scored alerts for HR
├── repositories/
│   └── behavior_repository.py      # DB reads/writes for logs and alerts
├── services/
│   └── behavior_service.py         # Pattern evaluation, scoring, alert triggering
├── schemas/
│   └── behavior.py                 # Pydantic response/input schemas
├── api/
│   └── behavior.py                 # HR-only REST endpoints
├── notifications/
│   └── notification_service.py     # In-app bell notification to HR users
└── core/templates/
    └── behavior_alert.html         # Email template for HR alerts

frontend/src/
├── hooks/
│   └── useBehaviorAlerts.js        # Fetch + resolve alerts
└── components/
    ├── BehaviorAlerts.jsx           # Signals card list UI
    └── HRPanel.jsx                  # Signals tab added here

alembic/versions/
└── add_behavioral_analytics.py     # Migration: document_access_logs + behavior_alerts
```

---

## Privacy & Guardrails

- Only access metadata is stored — never document content
- No alert fires on a single open — only repeated patterns within a window
- All `/hr/alerts` endpoints return 403 for non-HR roles
- Duplicate alerts are never created — existing open alerts are updated
- HR must not reveal to employees that their access was tracked
- `document_access_logs` is append-only and serves as a permanent audit trail
- Thresholds are configurable in `.env` — start high and tune down based on false-positive rates

---

## Future Improvements

- Time-of-day analysis — repeated access at unusual hours as an additional signal
- Cross-category correlation — POSH + Exit policy in the same week → combined higher score
- HR notes on resolution — free-text field for audit purposes
- ML-based anomaly detection — replace rule thresholds with a trained model once enough data exists
- Aggregated HR analytics dashboard — trends by team, department, document

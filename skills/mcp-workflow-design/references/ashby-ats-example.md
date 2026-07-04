# Example: Ashby ATS Workflow Design

> **This is a worked example for illustrative purposes.** It shows how the
> methodology from [SKILL.md](../SKILL.md) was applied to a real project (the
> ashby-mcp server). Use it as a reference when applying the same process to a
> different API or domain.

This documents the analysis process and decisions made when evolving the
ashby-mcp server from 30 atomic 1:1 API wrappers into an AI-native tool surface
with 7 composite workflow tools.

## Phase 1 Results: API Surface Audit

### Before (30 atomic tools)

28 read-only tools + 2 writes (`create_candidate_note`,
`set_custom_field_value`). Covered candidates, applications, jobs, interviews,
offers, users, custom fields, and reference data. All 1:1 wrappers using
`registerAshbyTool`.

### Full API (156 endpoints)

126 SDK functions were unexposed, including critical operations:

- `applicationChangeStage` (pipeline movement)
- `candidateCreate` / `applicationCreate` (intake)
- `applicationFeedbackList` / `applicationListCriteriaEvaluations` (feedback)
- `candidateAddTag` / `candidateRemoveTag` (organization)

### Gap: 6 atomic tools added

| Tool                              | SDK fn                    | Why                    |
| --------------------------------- | ------------------------- | ---------------------- |
| `ashby_create_candidate`          | `candidateCreate`         | Intake flow foundation |
| `ashby_create_application`        | `applicationCreate`       | Intake flow foundation |
| `ashby_change_application_stage`  | `applicationChangeStage`  | Pipeline management    |
| `ashby_add_candidate_tag`         | `candidateAddTag`         | Candidate organization |
| `ashby_remove_candidate_tag`      | `candidateRemoveTag`      | Candidate organization |
| `ashby_list_application_feedback` | `applicationFeedbackList` | Feedback access        |

## Phase 2 Results: Ashby Native Automation (Excluded)

These features are handled by Ashby's platform and were explicitly excluded from
tool design:

- **Automated email sequences / outreach** -- Ashby handles follow-up emails,
  drip campaigns, and outreach sequences natively.
- **AI-assisted application review** -- Ashby's AI screens inbound applications
  against job criteria with bias safeguards.
- **AI notetaker** -- records, transcribes, and summarizes interviews.
- **Conditional activities** -- enterprise feature that auto-creates stage
  activities (emails, assessments, background checks) based on candidate data.
- **AI content assistant** -- generates job descriptions, email templates,
  recruiting sequences with rich context.
- **Application requests** -- Ashby automates requesting complete application
  details from sourced/referred candidates already in the pipeline.
- **Fraudulent candidate detection** -- screening during application review.

## Phase 3 Results: Identified User Flows

Seven workflows identified by combining API topology analysis, ATS domain
knowledge, and vendor documentation research:

| Priority | Intent                                     | Pattern           | API Calls Saved |
| -------- | ------------------------------------------ | ----------------- | --------------- |
| 1        | "Tell me everything about this candidate"  | Fan-out aggregate | 5-10 -> 1       |
| 2        | "How's the Senior Engineer pipeline?"      | Fan-out aggregate | 4-6 -> 1        |
| 3        | "Move this candidate to Onsite"            | Resolve-then-act  | 3 -> 1          |
| 4        | "Add this person for the Eng Manager role" | Resolve-then-act  | 3 -> 1          |
| 5        | "What do interviewers think?"              | Fan-out aggregate | 3-5 -> 1        |
| 6        | "What happened with this application?"     | Fan-out aggregate | 3-4 -> 1        |
| 7        | "Give me a hiring snapshot"                | Fan-out aggregate | 10+ -> 1        |

## Phase 4 Results: Tool Designs

### ashby_candidate_360 (read)

Accepts: `candidateId` OR `email` OR `name`. Orchestrates: candidateSearch/Info
-> applicationList -> per-app feedback/history -> notes -> offers -> custom
fields. Returns: full profile with summary.

### ashby_job_pipeline_overview (read)

Accepts: `jobId` OR `jobTitle`. Orchestrates: jobSearch -> jobInfo ->
interviewPlan -> stages -> applicationList grouped by stage. Returns: pipeline
stages with candidate counts.

### ashby_advance_candidate (write)

Accepts: `applicationId` + `targetStageName` OR `targetStageId`. Orchestrates:
applicationInfo -> interviewStageList (resolve name) -> applicationChangeStage.
Returns: confirmation with old/new stage. Key: fuzzy stage name matching with
validation error listing available stages.

### ashby_submit_candidate (write)

Accepts: candidate details + `jobId` OR `jobTitle`. Orchestrates:
candidateSearch (dedup) -> candidateCreate -> applicationCreate. Returns:
created records or duplicate warning. Key: email-based dedup with
`skipDuplicateCheck` escape hatch.

### ashby_interview_feedback_summary (read)

Accepts: `applicationId` OR `candidateId`. Orchestrates: per-app feedbackList +
criteriaEvaluations + notes. Returns: aggregated feedback with counts.

### ashby_application_activity (read)

Accepts: `applicationId`. Orchestrates: applicationInfo + history + feedback +
schedules. Returns: chronological merged timeline.

### ashby_hiring_overview (read)

Accepts: optional `status`, `limit`. Orchestrates: jobList -> per-job app
counts + schedules + offers. Returns: dashboard with pipeline counts, upcoming
interviews, pending offers. Key: bounded to prevent runaway API calls (max 50
jobs, 1 page per job).

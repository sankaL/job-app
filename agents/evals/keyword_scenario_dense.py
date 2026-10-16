"""Fictional dense-draft keyword scenario: a data engineer's near-full one-page draft against a mixed posting.

The posting mixes tools, process phrases, a tenure phrase the dates support, and two credentials the candidate
does not hold. A draft this full leaves little room, so keywords must replace words, not just add them.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from resume_document import render_resume_document, validate_resume_document

JOB_TITLE = "Senior Data Engineer"
COMPANY = "Fictional Tidewater Analytics"

KEYWORDS = [
    "Python", "SQL", "ETL", "data pipelines", "data modeling", "Apache Airflow", "Snowflake", "dbt", "Spark",
    "Kafka", "AWS", "Docker", "CI/CD", "data quality", "data governance", "dashboards", "Tableau",
    "stakeholder communication", "Agile", "code reviews", "technical documentation", "root cause analysis",
    "performance tuning", "5+ years of experience", "mentoring", "data warehouse", "batch processing",
    "Google Cloud Professional Data Engineer", "Master's degree",
]
UNREACHABLE = ["Google Cloud Professional Data Engineer", "Master's degree"]

JOB_DESCRIPTION = (
    "Fictional Tidewater Analytics seeks a Senior Data Engineer with 5+ years of experience. You will design data pipelines and "
    "ETL jobs in Python and SQL, own data modeling for our Snowflake data warehouse, and schedule batch processing with Apache "
    "Airflow, dbt and Spark. Streaming data arrives through Kafka on AWS, and services ship in Docker through CI/CD. You will "
    "improve data quality and data governance, run performance tuning and root cause analysis when jobs fail, and build "
    "dashboards in Tableau. Strong stakeholder communication, Agile delivery, code reviews, technical documentation and "
    "mentoring are expected. A Master's degree is preferred, as is the Google Cloud Professional Data Engineer credential."
)


def source_document() -> dict[str, Any]:
    return validate_resume_document({"schema_version": 1, "revision": 5, "sections": [
        {"id": "summary", "kind": "summary", "heading": "Summary", "review_state": "reviewed",
         "content_md": "Data engineer with seven years building reliable reporting systems for retail and logistics teams. "
                       "Known for steady delivery, clear handoffs and careful work on data used by finance and operations."},
        {"id": "experience", "kind": "professional_experience", "heading": "Professional Experience",
         "review_state": "reviewed", "entries": [
            {"id": "role-one", "fields": {"title": "Data Engineer", "company": "Fictional Quarry Retail",
             "location": "Montreal", "date_range": "2022 - 2025"}, "bullets": [
                {"id": "one-a", "text": "Built Python jobs that load daily sales files into a reporting database for 40 stores, replacing a manual spreadsheet process."},
                {"id": "one-b", "text": "Rewrote slow SQL reports so the morning finance report finished in 12 minutes instead of 70."},
                {"id": "one-c", "text": "Added checks that flag missing or duplicate store files before reports are published, cutting reporting corrections by half."},
                {"id": "one-d", "text": "Worked with the finance team to define report fields and wrote a data dictionary used by new analysts."},
                {"id": "one-e", "text": "Trained two junior analysts to read job logs and fix common failures."},
            ]},
            {"id": "role-two", "fields": {"title": "Junior Data Engineer", "company": "Fictional Marsh Freight",
             "location": "Montreal", "date_range": "2020 - 2022"}, "bullets": [
                {"id": "two-a", "text": "Maintained nightly Python and SQL jobs that prepared shipment data for the operations team."},
                {"id": "two-b", "text": "Built a shipment delay report that dispatchers used each morning to reroute late trucks."},
                {"id": "two-c", "text": "Investigated failed overnight jobs and wrote short runbooks so the support team could restart them."},
                {"id": "two-d", "text": "Moved report scripts into version control and added a review step before changes went live."},
            ]},
            {"id": "role-three", "fields": {"title": "Reporting Analyst", "company": "Fictional Pier Logistics",
             "location": "Quebec City", "date_range": "2018 - 2020"}, "bullets": [
                {"id": "three-a", "text": "Produced weekly warehouse performance reports from SQL queries for three regional managers."},
                {"id": "three-b", "text": "Automated a monthly billing extract with Python, saving about six hours of manual work each month."},
                {"id": "three-c", "text": "Documented report definitions and answered data questions from operations staff."},
            ]},
         ]},
        {"id": "education", "kind": "education", "heading": "Education", "review_state": "reviewed",
         "entries": [{"id": "degree", "fields": {"qualification": "BSc Information Systems",
          "institution": "Fictional Northern University", "location": "Quebec City", "date_range": "2018"}}]},
        {"id": "certifications", "kind": "certifications", "heading": "Certifications", "review_state": "reviewed",
         "entries": [{"id": "certificate", "fields": {"name": "SQL Fundamentals Certificate",
          "issuer": "Fictional Learning Guild", "date": "2021"}}]},
        {"id": "skills", "kind": "skills", "heading": "Skills", "review_state": "reviewed",
         "content_md": "**Languages:** Python, SQL. **Data:** PostgreSQL, CSV and JSON file processing, report design. "
                       "**Practices:** version control, runbooks, data dictionaries, report documentation."},
        {"id": "projects", "kind": "projects", "heading": "Projects", "review_state": "reviewed",
         "entries": [{"id": "freight-project", "fields": {"name": "Freight Delay Dashboard"}, "bullets": [
            {"id": "project-a", "text": "Built an internal dashboard that shows late shipments by route, used by dispatch staff each shift."},
            {"id": "project-b", "text": "Wrote a Python script that checks incoming files and emails the team when a file is late."},
         ]}]},
    ]}).model_dump(mode="json")


def current_document() -> dict[str, Any]:
    current = deepcopy(source_document())
    current["revision"] = 6
    return validate_resume_document(current).model_dump(mode="json")


def snapshot() -> dict[str, Any]:
    source = source_document()
    return {"base_resume_id": "synthetic-base", "revision": source["revision"], "document": deepcopy(source),
            "content_md": render_resume_document(validate_resume_document(source), include_disabled=True)}

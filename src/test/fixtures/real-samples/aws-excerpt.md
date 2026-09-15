# Hardcoded Cloud Credentials in Public Backup File — Read/Write Access to Application Infrastructure

**Target**: www.example-target.com  
**Program**: YesWeHack – ExampleBrand  
**Type**: Hardcoded Credentials / Sensitive Data Exposure (CWE-798)  
**Severity**: Critical  
**CVSS v3.1**: 10.0 — `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H`  
**Related report**: #YWH-PGMXXXXX-5 (escalation)

---

## 1. Description

A publicly accessible cloud object-storage bucket (reported in #YWH-PGMXXXXX-5)
contains an infrastructure configuration backup (10 MB) that is freely
downloadable without authentication.

The backup file contains hardcoded cloud IAM credentials stored in plaintext
inside binary data pages, as part of a plugin configuration value in the CMS
settings table.

The credentials belong to an automation IAM user in the vendor's cloud account
that operates the CMS platform for Example Corp. Using these credentials it is
possible to list, read, and write to all storage buckets used by the
application, including user-uploaded content, documents, photos, and
application assets.

Write access was confirmed by uploading a proof file to the bucket during the
assessment.

## 2. Remediation

Rotate the exposed credentials, restrict bucket permissions, and remove
backups from public access.

# HouseXpert — MongoDB Schema Reference

## Collections

| Collection       | Model File          | Description                                      |
|------------------|---------------------|--------------------------------------------------|
| `projects`       | project.go          | Construction/interior projects with BHK configs  |
| `employees`      | employee.go         | Company staff + system users (RBAC roles)        |
| `attendance`     | attendance.go       | Daily attendance records (biometric + manual)    |
| `inquiries`      | client.go           | Incoming leads before client conversion          |
| `clients`        | client.go           | Converted customers linked to projects           |
| `vendors`        | vendor.go           | Suppliers with GSTIN and contact info            |
| `products`       | vendor.go           | Product catalog linked to vendors                |
| `log_types`      | log_schema.go       | Company-level log type definitions (Material etc)|
| `log_categories` | log_category.go     | Categories under each log type (Plywood, Tiles)  |
| `log_entries`    | log_entry.go        | Daily project log entries with schema versioning |

## Schema Versioning (Log System)

When a LogType schema is edited:
- A new version is created and stored in `schema_history`
- `current_version` is incremented
- `current_schema` is updated to the new fields
- All new LogEntries store the `schema_version` they were created with
- Old entries are never modified — they render using their original version

## Soft Delete Policy

Nothing is hard deleted. All records use a `status` field:
- `active` — visible and usable
- `inactive` — hidden from UI but exists in DB
- `archived` — soft deleted, hidden from forms, visible in reports

## ID Formats

| Entity   | Format    | Example   |
|----------|-----------|-----------|
| Project  | PROJ-XXX  | PROJ-001  |
| Employee | E-XXX     | E-001     |
| Client   | CLT-XXX   | CLT-001   |
| Vendor   | VND-XXX   | VND-001   |
| Product  | PRD-XXX   | PRD-001   |

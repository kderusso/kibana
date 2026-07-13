# Context Engine

Server-side plugin for the Context Engine.

## Namespaces API

Namespaces attach a logical name to an existing user index, index pattern, or
data stream. Namespace records are stored in a hidden Kibana system index
(`.contextengine-namespaces`), separate from the backing data.

| Method   | Path                                  | Description                     |
| -------- | ------------------------------------- | ------------------------------- |
| `PUT`    | `/api/context_engine/namespace/{id}`  | Create or update a namespace    |
| `GET`    | `/api/context_engine/namespace/{id}`  | Get a namespace by id           |
| `GET`    | `/api/context_engine/namespace`       | List namespaces (max 100)       |
| `DELETE` | `/api/context_engine/namespace/{id}`  | Delete a namespace              |

Notes:

- The API is gated behind the `contextEngine:enabled` advanced setting
  (disabled by default). All routes return 404 while the setting is off.
- The source data stream must already exist when
  creating or updating a namespace. System indices are not allowed. Data streams
  are the only supported source.
- Deleting a namespace deletes **only** the namespace entry. Backing indices
  are left untouched and must be removed with the Delete index API if desired.

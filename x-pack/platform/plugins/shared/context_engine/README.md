# Context Engine

Server-side plugin for the Context Engine.

## AI Indices API

AI indices attach a logical name to an existing user index pattern or data
stream. AI index records are stored in a hidden Kibana system index
(`.contextengine-ai-indices`), separate from the backing data.

| Method   | Path                                  | Description                     |
| -------- | ------------------------------------- | ------------------------------- |
| `PUT`    | `/api/context_engine/ai_index/{id}`   | Create or update an AI index    |
| `GET`    | `/api/context_engine/ai_index/{id}`   | Get an AI index by id           |
| `GET`    | `/api/context_engine/ai_index`        | List AI indices (max 100)       |
| `DELETE` | `/api/context_engine/ai_index/{id}`   | Delete an AI index              |

Notes:

- The API is gated behind the `contextEngine:enabled` advanced setting
  (disabled by default). All routes return 404 while the setting is off.
- The backing index is set via `dest`, an object of the form
  `{ "index": "<index or pattern>" }`. `dest.index` must already exist when
  creating or updating an AI index and must match the declared `type`:
  `data_stream` for a data stream, or `index_pattern` for an index pattern (e.g.
  `.ai-index-foo`, `.ai-index-foo*`). Every resolved index (or data stream) must
  start with `.ai-index-`; system indices are not allowed.
- Deleting an AI index deletes **only** the AI index entry. Backing indices
  are left untouched and must be removed with the Delete index API if desired.

# CSE 341 — Board Game Library API

A REST API for a board game collection and the play sessions logged against it,
backed by MongoDB Atlas, with interactive OpenAPI documentation. Built for
CSE 341 Web Services, project 2.

- **Interactive docs:** `/api-docs`
- **Raw OpenAPI 3 document:** `/swagger.json`

## Endpoints

| Method   | Path            | Purpose                            | Success |
| -------- | --------------- | ---------------------------------- | ------- |
| `GET`    | `/`             | Welcome message / health check     | 200     |
| `GET`    | `/games`        | List every game, by title          | 200     |
| `GET`    | `/games/:id`    | Get one game                       | 200     |
| `POST`   | `/games`        | Create a game                      | 201     |
| `PUT`    | `/games/:id`    | Replace a game                     | 204     |
| `DELETE` | `/games/:id`    | Delete a game **and its sessions** | 204     |
| `GET`    | `/sessions`     | List sessions, newest first        | 200     |
| `GET`    | `/sessions/:id` | Get one session                    | 200     |
| `POST`   | `/sessions`     | Record a session                   | 201     |
| `PUT`    | `/sessions/:id` | Replace a session                  | 204     |
| `DELETE` | `/sessions/:id` | Delete a session                   | 204     |
| `GET`    | `/api-docs`     | Interactive Swagger UI             | 200     |
| `GET`    | `/swagger.json` | The raw OpenAPI document           | 200     |

`GET /sessions` accepts an optional `?gameId=` filter to return only the
sessions belonging to one game.

Errors: **400** for a malformed id or an invalid body (the response lists every
problem found, not just the first), **404** for an id that matches nothing, and
**500** for a server fault. A `POST` returns a `Location` header pointing at the
new resource; `PUT` and `DELETE` return `204` with a deliberately empty body.

## Data model

Two collections in the `boardgames` database.

### `games` — nine fields, all required

| Field             | Type     | Rules                              |
| ----------------- | -------- | ---------------------------------- |
| `title`           | string   | non-empty                          |
| `publisher`       | string   | non-empty                          |
| `yearPublished`   | integer  | 1900 to next year                  |
| `minPlayers`      | integer  | at least 1                         |
| `maxPlayers`      | integer  | at least 1, and **≥ `minPlayers`** |
| `playTimeMinutes` | integer  | at least 1                         |
| `complexity`      | string   | one of `light`, `medium`, `heavy`  |
| `categories`      | string[] | at least one non-empty entry       |
| `ownerEmail`      | string   | email-shaped; stored lowercased    |

### `sessions` — six fields, five required

| Field             | Type     | Rules                                        |
| ----------------- | -------- | -------------------------------------------- |
| `gameId`          | ObjectId | **must reference a game that exists**        |
| `playedOn`        | string   | `YYYY-MM-DD`, a real date, not in the future |
| `players`         | string[] | at least one non-empty entry                 |
| `winner`          | string   | **must be one of `players`**                 |
| `durationMinutes` | integer  | at least 1                                   |
| `notes`           | string   | optional, 500 characters or fewer            |

Three of those rules span more than one field or collection, which is where most
of the interesting `400` responses come from:

- `maxPlayers` must not be below `minPlayers`
- `winner` must be a name that appears in `players`
- `gameId` must point at a game that is really there

Because sessions reference games, `DELETE /games/:id` also deletes that game's
sessions — otherwise they would be left pointing at nothing.

`PUT` replaces the whole document, which is what PUT means in HTTP. It therefore
requires every field, exactly like `POST`, and omitting the optional `notes`
removes it. Any field not listed above is ignored rather than stored, so a
caller cannot add extra keys to a request body and have them persisted.

## Running it locally

```bash
npm install
cp .env.example .env          # then fill in your Atlas credentials
npm run seed -- --fresh       # load the sample games and sessions
npm start
```

Then open <http://localhost:8080/api-docs> for the documentation, or send the
requests in `games.rest` and `sessions.rest` with the VS Code REST Client
extension. Those two files cover every route and every validation rule, and each
request states the status code it should return.

## Scripts

| Script                    | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `npm start`               | Run the server                                      |
| `npm run dev`             | Run it with `--watch`, restarting on every save     |
| `npm run seed`            | Add or update the sample data (safe to re-run)      |
| `npm run seed -- --fresh` | Empty both collections first, then load sample data |
| `npm run swagger`         | Regenerate `swagger-output.json` from the routes    |
| `npm run lint`            | ESLint                                              |
| `npm run format`          | Prettier, writing changes                           |

**Run `npm run swagger` after any change to the routes.** The generated
`swagger-output.json` is a snapshot that is committed to the repo, not something
the server works out at startup, so stale docs are a real possibility.

The seed script checks every fixture against the API's own validators before
writing it, so `data/games.json` and `data/sessions.json` cannot drift out of
step with the rules the endpoints enforce.

## Project layout

```
server.js                  express setup, CORS, /api-docs, 404 and error handlers
swagger.js                 generates swagger-output.json from the route files
routes/                    URL and method -> controller function
controllers/               validation and the database work for each collection
utils/validation.js        shared validation primitives used by both controllers
data/database.js           the single shared MongoClient, plus collection helpers
data/seed.js               loads data/games.json and data/sessions.json
*.rest                     request-by-request tests for the REST Client extension
```

## Configuration

Every value comes from the environment; nothing sensitive is committed. See
`.env.example` for the full list.

| Variable                               | Purpose                  |
| -------------------------------------- | ------------------------ |
| `MONGODB_URI`                          | Atlas connection string  |
| `MONGODB_USERNAME`, `MONGODB_PASSWORD` | spliced into the URI     |
| `MONGODB_DB_NAME`                      | defaults to `boardgames` |
| `PORT`                                 | defaults to 8080         |

`.env` is git-ignored. On Render these are set as environment variables in the
dashboard instead — and `PORT` is deliberately **not** set there, because Render
assigns one at runtime.

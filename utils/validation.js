/**
 * Shared validation primitives.
 *
 * The contacts project had one collection, so its validation lived entirely
 * inside its controller. This project has two collections with overlapping
 * rules ("a required non-empty string", "an integer of at least 1"), so those
 * rules live here and are *composed* in each controller. Writing the message
 * text once also means every 400 response across the API is phrased the same
 * way.
 *
 * The shape is a small collector. `createValidator(body)` returns an object
 * whose methods each check one field, record a message when it is wrong, and
 * copy the cleaned value into `document` when it is right:
 *
 *     const v = createValidator(req.body);
 *     v.string('title');
 *     v.int('minPlayers', { min: 1 });
 *     const { errors, document } = v.result();
 *
 * Two properties fall out of this design and both matter:
 *
 *   1. Every field is checked, so one bad request produces a complete list of
 *      problems instead of only the first one.
 *   2. `document` is built ONLY from fields a method was called for. A caller
 *      cannot smuggle an extra key — `isAdmin: true`, say — into the database
 *      by adding it to the JSON, because nothing ever copies it across.
 */

const { ObjectId } = require('mongodb');

// MongoDB ObjectIds are exactly 24 hexadecimal characters. Checking the shape
// ourselves lets us answer 400 ("you sent a bad ID") instead of letting
// `new ObjectId()` throw and turning a client mistake into a 500 server error.
const isValidObjectId = (id) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

// `typeof null` is 'object' and so is an array, so both have to be excluded
// explicitly. Express gives req.body as `{}` when there is no body at all.
const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Deliberately loose: "something, an @, something, a dot, something". Fully
// validating an address per RFC 5322 takes a monstrous regex and still cannot
// tell you whether the mailbox exists, so this only catches obvious typos.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Today in YYYY-MM-DD, using UTC so the result does not shift by a day
// depending on the server's timezone. Render runs in UTC; your laptop does not.
const todayIso = () => new Date().toISOString().slice(0, 10);

const createValidator = (body) => {
  const errors = [];
  const document = {};

  /** Records a problem. Returns false so callers can `if (!fail(...)) return;` */
  const fail = (message) => {
    errors.push(message);
    return false;
  };

  const api = {
    /** A required, non-empty string. Stored trimmed. */
    string(field, { max = 200 } = {}) {
      const value = body[field];

      if (typeof value !== 'string' || value.trim() === '') {
        return fail(`"${field}" is required and must be a non-empty string.`);
      }
      if (value.trim().length > max) {
        return fail(`"${field}" must be ${max} characters or fewer.`);
      }

      document[field] = value.trim();
      return true;
    },

    /**
     * An optional string. Absent and null are both fine and store nothing;
     * anything present must still be the right type and length. An empty string
     * is accepted and stored as-is, so a caller can deliberately clear it.
     */
    optionalString(field, { max = 500 } = {}) {
      const value = body[field];

      if (value === undefined || value === null) return true;

      if (typeof value !== 'string') {
        return fail(`"${field}" must be a string when provided.`);
      }
      if (value.trim().length > max) {
        return fail(`"${field}" must be ${max} characters or fewer.`);
      }

      document[field] = value.trim();
      return true;
    },

    /**
     * A required whole number. Strict about type: the JSON `5` is accepted but
     * the JSON `"5"` is not. Being strict means a caller who sends the wrong
     * type is told so, rather than having it quietly coerced and stored in a
     * shape that later queries do not match.
     */
    int(field, { min, max } = {}) {
      const value = body[field];

      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return fail(`"${field}" is required and must be a whole number (not a string).`);
      }
      if (min !== undefined && value < min) {
        return fail(`"${field}" must be ${min} or greater.`);
      }
      if (max !== undefined && value > max) {
        return fail(`"${field}" must be ${max} or less.`);
      }

      document[field] = value;
      return true;
    },

    /** A required string drawn from a fixed set of allowed values. */
    enumOf(field, allowed) {
      const value = body[field];

      if (typeof value !== 'string' || !allowed.includes(value)) {
        return fail(`"${field}" must be one of: ${allowed.join(', ')}.`);
      }

      document[field] = value;
      return true;
    },

    /** A required array of at least `minItems` non-empty strings, each trimmed. */
    stringArray(field, { minItems = 1, max = 100 } = {}) {
      const value = body[field];

      if (!Array.isArray(value)) {
        return fail(`"${field}" is required and must be an array of strings.`);
      }
      if (value.length < minItems) {
        return fail(`"${field}" must contain at least ${minItems} item(s).`);
      }
      if (value.length > max) {
        return fail(`"${field}" must contain ${max} item(s) or fewer.`);
      }
      if (!value.every((item) => typeof item === 'string' && item.trim() !== '')) {
        return fail(`"${field}" must contain only non-empty strings.`);
      }

      document[field] = value.map((item) => item.trim());
      return true;
    },

    /** A required email-shaped string. Stored trimmed and lowercased. */
    email(field) {
      if (!api.string(field)) return false;

      if (!EMAIL_PATTERN.test(document[field])) {
        delete document[field];
        return fail(`"${field}" must look like an email address, e.g. name@example.com.`);
      }

      document[field] = document[field].toLowerCase();
      return true;
    },

    /**
     * A required ISO 8601 calendar date (YYYY-MM-DD). Stored as the string, not
     * a Date: it is unambiguous, it sorts correctly as text, and it survives a
     * round trip through JSON without a timezone quietly shifting it.
     */
    isoDate(field, { notFuture = false } = {}) {
      const value = body[field];

      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return fail(`"${field}" is required and must be a date in YYYY-MM-DD format.`);
      }

      // The round trip is what rejects shapes that match the pattern but are not
      // real dates, like 2024-02-31: JavaScript would roll that over to March 2,
      // so re-formatting the parsed date no longer equals what came in.
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        return fail(`"${field}" is not a real calendar date.`);
      }

      if (notFuture && value > todayIso()) {
        // String comparison is safe here precisely because the format is
        // fixed-width and big-endian — that is the whole point of ISO 8601.
        return fail(`"${field}" cannot be in the future.`);
      }

      document[field] = value;
      return true;
    },

    /**
     * A required reference to another document, given as a 24-character hex
     * string. Stored as a real ObjectId, NOT as the string: a query for the
     * string `"6aa2..."` will not match a stored ObjectId, so converting here is
     * what makes `sessions.gameId` joinable to `games._id` at all.
     *
     * This only checks the *shape*. Whether a document with that id actually
     * exists needs a database round trip, so the controller does it — and the
     * distinction matters, because a malformed id is a 400 while a well-formed
     * id that matches nothing is a 404.
     */
    objectId(field) {
      const value = body[field];

      if (!isValidObjectId(value)) {
        return fail(`"${field}" is required and must be a 24-character hex MongoDB ObjectId.`);
      }

      document[field] = new ObjectId(value);
      return true;
    },

    /**
     * An escape hatch for rules that span more than one field, such as
     * "maxPlayers must be at least minPlayers". Call it after the individual
     * fields have been checked, so `document` already holds the clean values.
     */
    check(condition, message) {
      if (!condition) return fail(message);
      return true;
    },

    /**
     * `errors` and `document` are the same objects the methods have been writing
     * to, not copies, so a caller may still append a cross-field error after
     * calling this.
     */
    result() {
      return { errors, document };
    },
  };

  return api;
};

module.exports = { createValidator, isValidObjectId, isPlainObject, todayIso };

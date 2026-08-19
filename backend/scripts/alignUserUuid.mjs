// One-off, idempotent: align the Prisma schema with the real DB where
// users.id (and other *_id PKs) are uuid. Adds @db.UuidString to:
//   - the `id` field ONLY when it is `@id @default(uuid())` (a uuid PK)
//   - user-reference columns: user_id | author_id | owner_id | referee_id |
//     referrer_id | creator_id | invited_by (plain String scalars)
// Skips anything already annotated, arrays (String[]), and non-matching lines.
import fs from "fs";

const path = "prisma/schema.prisma";
const src = fs.readFileSync(path, "utf8");

const UUID = "@db.UuidString";

// Matches a single scalar String field named one of the user-ref columns,
// optionally with trailing attributes, NOT already uuid, NOT an array.
const USER_REF = new RegExp(
  String.raw`^(\s+)(user_id|author_id|owner_id|referee_id|referrer_id|creator_id|invited_by)\s+String(\s+[A-Za-z@].*)?$`,
);

let changed = 0;
const out = src.split("\n").map((line) => {
  // uuid PK: `id String @id @default(uuid())`
  if (/^\s+id\s+String\s+@id\s+@default\(uuid\(\)\)\s*$/.test(line)) {
    if (line.includes(UUID)) return line;
    changed++;
    return line.replace(/String\s+@id/, `String ${UUID} @id`);
  }
  // user-reference columns
  const m = USER_REF.exec(line);
  if (m && !line.includes(UUID) && !line.includes("[]")) {
    changed++;
    return line.replace(/String(\s+[A-Za-z@].*)?$/, `String ${UUID}$1`);
  }
  return line;
});

fs.writeFileSync(path, out.join("\n"));
console.log("Annotated lines:", changed);

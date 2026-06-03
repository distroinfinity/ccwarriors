import { describe, it, expect } from "vitest";
import { makeDb } from "./helpers/db.js";
import { users } from "../src/db/schema.js";

describe("test db", () => {
  it("migrates and starts empty", async () => {
    const db = await makeDb();
    const rows = await db.select().from(users);
    expect(rows).toEqual([]);
  });
});

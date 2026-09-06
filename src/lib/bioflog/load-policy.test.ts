import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decideLoadMode,
  decideLoadModeOnError,
  mayApplyDemoLogins,
  mayMutate,
  maySeedDemo,
  mayPersist,
} from "./load-policy.ts";

test("real state on either backend is read/write", () => {
  assert.equal(decideLoadMode({ source: "neon", hasDb: true }), "remote");
  assert.equal(decideLoadMode({ source: "pglite", hasDb: true }), "remote");
});

test("local backend with no state may seed demo data", () => {
  const mode = decideLoadMode({ source: "pglite", hasDb: false });
  assert.equal(mode, "demo");
  assert.equal(maySeedDemo(mode), true);
  assert.equal(mayPersist(mode), true);
});

// The regression this whole module exists for.
test("Neon load failure + mutation != write demo data", () => {
  const mode = decideLoadMode({ source: "neon", hasDb: false });
  assert.equal(mode, "unavailable");
  assert.equal(maySeedDemo(mode), false, "must not seed demo data over production");
  assert.equal(mayMutate(mode), false, "mutation must be blocked, not merely unsaved");
  assert.equal(mayPersist(mode), false, "must not write anything back to Neon");
});

test("a thrown load is never writable", () => {
  const mode = decideLoadModeOnError();
  assert.equal(mode, "unavailable");
  assert.equal(mayPersist(mode), false);
  assert.equal(mayMutate(mode), false);
});

test("demo passwords are never forced onto Neon accounts", () => {
  assert.equal(mayApplyDemoLogins("neon"), false);
  assert.equal(mayApplyDemoLogins("pglite"), true);
});

test("every unavailable-mode capability is denied", () => {
  for (const can of [maySeedDemo, mayPersist, mayMutate]) {
    assert.equal(can("unavailable"), false);
  }
});

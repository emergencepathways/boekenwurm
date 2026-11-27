import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../src/json.ts";

test("JSON is found inside fences and prose, and braces inside strings don't confuse it", () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"a": "x}y", "b": [1,2]}\n```'), { a: "x}y", b: [1, 2] });
  assert.deepEqual(parseJson('[{"id":"p1"}] trailing'), [{ id: "p1" }]);
  assert.throws(() => parseJson("no json here"));
  assert.throws(() => parseJson('{"a": 1'));
});

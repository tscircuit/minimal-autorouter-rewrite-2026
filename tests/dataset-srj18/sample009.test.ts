import { test } from "bun:test"
import sample from "../../datasets/dataset-srj18/sample009.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { assertSample } from "./assertSample"

test("dataset-srj18 sample009: incremental solve connects every net and preserves input", () => {
  assertSample(sample as SimpleRouteJson, "sample009")
}, 300_000)

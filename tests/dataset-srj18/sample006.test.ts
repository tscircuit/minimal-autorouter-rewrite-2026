import { test } from "bun:test"
import sample from "../../datasets/dataset-srj18/sample006.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { assertSample } from "./assertSample"

test("dataset-srj18 sample006: incremental solve connects every net and preserves input", () => {
  assertSample(sample as SimpleRouteJson, "sample006")
}, 300_000)

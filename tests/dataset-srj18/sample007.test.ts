import { test } from "bun:test"
import sample from "../../datasets/dataset-srj18/sample007.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { assertSample } from "./assertSample"

test("dataset-srj18 sample007: incremental solve connects every net and preserves input", () => {
  assertSample(sample as SimpleRouteJson, "sample007")
}, 300_000)

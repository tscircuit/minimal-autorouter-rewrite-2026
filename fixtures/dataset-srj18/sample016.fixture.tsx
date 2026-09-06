import sample from "../../datasets/dataset-srj18/sample016.json"
import corrected from "../../imports/dataset-srj18/sample016.corrected.srj.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default {
  "Corrected import": <RoutingDebugger sampleName="sample016 — corrected import" srj={corrected as SimpleRouteJson} />,
  "Original import": <RoutingDebugger sampleName="sample016 — original import" srj={sample as SimpleRouteJson} />,
}

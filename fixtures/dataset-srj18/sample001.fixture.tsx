import sample from "../../datasets/dataset-srj18/sample001.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample001" srj={sample as SimpleRouteJson} />

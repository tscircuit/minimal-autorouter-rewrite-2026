import sample from "../../datasets/dataset-srj18/sample012.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample012" srj={sample as SimpleRouteJson} />

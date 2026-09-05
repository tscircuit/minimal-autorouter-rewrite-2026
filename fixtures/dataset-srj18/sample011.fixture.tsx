import sample from "../../datasets/dataset-srj18/sample011.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample011" srj={sample as SimpleRouteJson} />

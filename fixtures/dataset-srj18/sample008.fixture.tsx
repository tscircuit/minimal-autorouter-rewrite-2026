import sample from "../../datasets/dataset-srj18/sample008.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample008" srj={sample as SimpleRouteJson} />

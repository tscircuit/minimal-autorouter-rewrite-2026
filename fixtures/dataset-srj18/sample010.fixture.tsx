import sample from "../../datasets/dataset-srj18/sample010.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample010" srj={sample as SimpleRouteJson} />

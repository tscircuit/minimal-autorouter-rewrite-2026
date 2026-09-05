import sample from "../../datasets/dataset-srj18/sample007.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { RoutingDebugger } from "../RoutingDebugger"

export default <RoutingDebugger sampleName="sample007" srj={sample as SimpleRouteJson} />

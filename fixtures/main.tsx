import { createRoot } from "react-dom/client"
import fixture from "./dataset-srj18/sample001.fixture"

// Cosmos substitutes its fixture renderer for this entry; direct Vite opens sample001.
createRoot(document.getElementById("root")!).render(fixture)

export { analyze, assessEvent, buildContent, eventCountries, isDuplicate, matchEvent, relevantCountries, vec } from "../src/engine/engine.ts";
import { vec } from "../src/engine/engine.ts";
import { centroid } from "../src/engine/text.ts";
import type { Analysis } from "../src/engine/types.ts";
export const eventCentroidFor = (ans: Analysis[]) => centroid(ans.map(vec));

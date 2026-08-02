/** One-shot manual invocation for a controlled operational-monitoring proof. */
import { runOperationalMonitor } from "../lib/operational-monitor";

const result = await runOperationalMonitor();
console.log(JSON.stringify({ event: "operational_monitor_manual", ...result }));

import { LeakReport, Logger, RegistryEntry } from "./types.js";

export function createReporter(logger?: Logger){
    const activeLogger: Logger = logger ?? console;

    return{
        report(entry: RegistryEntry, heldForMs: number){
            const report: LeakReport = {
                stack: entry.stack,
                heldForMs,
                ...(entry.message && {message: entry.message})
            }

            const loggerMessage = `Resource leak detected: connection held for ${heldForMs}ms`;
            activeLogger.warn(loggerMessage, report)
        }
    }
}
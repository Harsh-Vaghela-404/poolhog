export type RegistryEntry = {
    stack: string;
    checkoutTime: number;
    message?: string;
}

export type LeakReport = {
    stack: string;
    heldForMs: number;
    message?: string;
}

export type Logger = {
    warn(message: string, meta? : Record<string, unknown>): void;
}
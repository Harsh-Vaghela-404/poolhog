import {RegistryEntry} from './types.js'


export function createRegistry(){
    const map: Map<object, RegistryEntry> = new Map();

    return {
        track(client: object ,entry: RegistryEntry): void {
            map.set(client, entry);
        },
        untrack(client: object): void{
            map.delete(client);
        },
        get(client: object): RegistryEntry | undefined{
            return map.get(client);
        },
        entries(): IterableIterator<[object, RegistryEntry]>{
            return map.entries()
        }
    }
}
import { describe, test, expect } from "@jest/globals";
import {createRegistry } from '../src/registry.ts';



describe('Client Registration', ()=>{

    test('Create Client', ()=>{
        const {track} = createRegistry()
        const client = {
            name: 'pg',
            message: 'test'
        };

        const entry = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };

        expect(track(client, entry)).toEqual(undefined)
    })

    test('Get Client', ()=>{
        const {track, get} = createRegistry()
        const client = {
            name: 'pg',
            message: 'test'
        };

        const entry = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };
        track(client, entry);

        expect(get(client)).toEqual(entry)
    })

    test('Entries Client', ()=>{
        const {track, entries} = createRegistry()
        const client1 = {
            name: 'pg',
            message: 'test'
        };

        const entry1 = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };

        const client2 = {
            name: 'pg2',
            message: 'test2'
        };

        const entry2 = {
            stack: 'pg2', 
            checkoutTime: Date.now(), 
            message: 'test 2'
        };

        const client3 = {
            name: 'pg3',
            message: 'test3'
        };

        const entry3 = {
            stack: 'pg3', 
            checkoutTime: Date.now(), 
            message: 'test 3'
        };

        const expected = [[client1, entry1], [client2, entry2],[client3, entry3]];

        track(client1, entry1);
        track(client2, entry2);
        track(client3, entry3);

        expect(Array.from(entries())).toEqual(expected)
    })

    test('Untrack Client', ()=>{
        const {track, untrack} = createRegistry()
        const client = {
            name: 'pg',
            message: 'test'
        };

        const entry = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };

        track(client, entry);

        expect(untrack(client)).toEqual(undefined)

    })

    test('Test Client Deleted', ()=>{
        const {track, untrack, get} = createRegistry()
        const client = {
            name: 'pg',
            message: 'test'
        };

        const entry = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };

        track(client, entry);

        expect(untrack(client)).toEqual(undefined);

        expect(get(client)).toEqual(undefined);
    })
    
    test('Untracked Client Get', ()=>{
        const {get} = createRegistry();

        const client = {
            name: 'pg',
            message: 'test'
        };

        expect(get(client)).toEqual(undefined)
    })

    test('Untrack Untracked client', ()=>{
        const {track, untrack} = createRegistry()
        const client = {
            name: 'pg',
            message: 'test'
        };

        const entry = {
            stack: 'pg', 
            checkoutTime: Date.now(), 
            message: 'test 1'
        };

        track(client, entry);
        untrack(client);
        expect(untrack(client)).toBe(undefined);
    })
})
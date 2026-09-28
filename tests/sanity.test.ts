import {describe, test, expect} from '@jest/globals'
import {sum} from '../src/index.ts';

describe('Sum Function', ()=>{
    test('Return correct value', ()=>{
        expect(sum(2,3)).toEqual(5);
    })
})
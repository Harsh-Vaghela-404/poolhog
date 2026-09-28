
type onExpireType = (key: object) => void;

export function createLeakTimer(thresholdMs: number, onExpire:onExpireType){
    let timerMap: Map<object, NodeJS.Timeout> = new Map();
    return {
        schedule(key: object){
            const timer = setTimeout(() => {
                onExpire(key)
                timerMap.delete(key);
            }, thresholdMs).unref();

            timerMap.set(key, timer)
        },
        cancel(key: object){
            if(!timerMap.has(key)){
                return
            }
            const setTimer = timerMap.get(key);
            clearTimeout(setTimer);
            timerMap.delete(key);
        }
    }
}
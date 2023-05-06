import { browser } from '$app/environment';
import { errorLogger } from '$lib/utils/log';
import { type Writable, writable } from 'svelte/store';

export function localStorageWritable<T>(
    lsKey: string,
    initial: T extends (...args: infer _) => infer _ ? never : T
): Writable<T> {
    if (typeof initial === 'function') {
        throw new Error(
            'localStorageWritable does not support setting a function'
        );
    }

    if (browser) {
        const lsVal = localStorage.getItem(lsKey);
        if (lsVal !== null) {
            try {
                initial = JSON.parse(lsVal) as T extends (
                    ...args: infer _
                ) => infer _
                    ? never
                    : T;
            } catch (e) {
                errorLogger.error('Error parsing localStorage value', e);
            }
        }

        localStorage.setItem(lsKey, JSON.stringify(initial));
    }

    const store = writable<T>(initial);

    const { subscribe, set, update } = store;

    return {
        subscribe,
        set: value => {
            if (typeof value === 'function') {
                throw new Error(
                    'localStorageWritable does not support setting a function'
                );
            }
            set(value);
            if (!browser) return;
            if (value === null || value === undefined) {
                localStorage.removeItem(lsKey);
                return;
            }
            localStorage.setItem(lsKey, JSON.stringify(value));
        },
        update: fn => {
            update(value => {
                const newValue = fn(value);

                if (typeof newValue === 'function') {
                    throw new Error(
                        'localStorageWritable does not support setting a function'
                    );
                }

                if (!browser) return newValue;
                if (newValue === null || newValue === undefined) {
                    localStorage.removeItem(lsKey);
                } else {
                    localStorage.setItem(lsKey, JSON.stringify(newValue));
                }
                return newValue;
            });
        }
    };
}

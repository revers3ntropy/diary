import DomPurify from 'dompurify';
import { marked } from 'marked';
import { OBFUSCATE_CHARS } from '../constants';

export function obfuscate(str: string, _alphabet = OBFUSCATE_CHARS): string {
    return str;
    // return str.replace(/./g, char => {
    //     if (char === '\n') {
    //         return char;
    //     }
    //     return alphabet[Math.floor(Math.random() * alphabet.length)];
    // });
}

function intlSegmenterSupported() {
    return typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined';
}

const wordSplitter = intlSegmenterSupported()
    ? new Intl.Segmenter('en', {
          granularity: 'word'
      })
    : (null as unknown as Intl.Segmenter);

function wordsFromTextWithIntl(text: string): string[] {
    return Array.from(wordSplitter.segment(text), segment => {
        if (!segment.isWordLike) {
            return null;
        }
        return segment.segment;
    }).filter(Boolean);
}

/**
 * @src https://stackoverflow.com/questions/18473326/javascript-break-sentence-by-words
 */
function wordsFromTextWithoutIntl(text: string): string[] {
    return (text.match(/\b(\w+)'?(\w+)?\b/g) || []).filter(Boolean);
}

export const wordsFromText = intlSegmenterSupported()
    ? wordsFromTextWithIntl
    : wordsFromTextWithoutIntl;

export function wordCount(text: string): number {
    return wordsFromText(text).length;
}

export function numberAsSignedStr(num: number): string {
    return num >= 0 ? `+${num}` : `${num}`;
}

export function roundToDecimalPlaces(num: number, n: number = 1): number {
    return Math.round(num * 10 ** n) / 10 ** n;
}

export function rawMdToHtml(md: string, obfuscated = false): string {
    // this is pretty dumb...
    // https://github.com/markedjs/marked/issues/2793
    marked.use({
        mangle: false,
        headerIds: false
    });

    return DomPurify.sanitize(marked.parse(obfuscated ? obfuscate(md) : md));
}

export function limitStrLen(str: string, len: number, append = '..'): string {
    if (str.length <= len) {
        return str;
    }
    return `${str.substring(0, len - 1)}${append}`;
}

export function fmtBytes(bytes: number): string {
    if (bytes < 0) {
        return `-${fmtBytes(-bytes)}`;
    }
    if (bytes < 1000) {
        return `${bytes}B`;
    }
    if (bytes < 1000 * 1000) {
        return `${roundToDecimalPlaces(bytes / 1000)}KB`;
    }
    if (bytes < 1000 * 1000 * 1000) {
        return `${roundToDecimalPlaces(bytes / 1000 / 1000)}MB`;
    }
    return `${roundToDecimalPlaces(bytes / 1000 / 1000 / 1000)}GB`;
}

export function removeAnsi(str: string): string {
    return str.replace(
        // eslint-disable-next-line no-control-regex
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ''
    );
}

export function capitalise(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function collapseWhitespace(str: string): string {
    return str.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(`'`, `\\'`).trim();
}

export function recursivelyTrimAndStringify<T>(obj: T, maxStrLen = 10, maxKeys = 3): string {
    if (typeof obj === 'string') {
        if (obj.length > maxStrLen) {
            return `'${collapseWhitespace(obj.slice(0, maxStrLen))}'..${obj.length - maxStrLen}`;
        }
        return `'${collapseWhitespace(obj)}'`;
    } else if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
            if (obj.length > maxKeys) {
                return (
                    '[' +
                    obj
                        .slice(0, maxKeys)
                        .map(o => recursivelyTrimAndStringify(o, maxStrLen, maxKeys))
                        .join(', ') +
                    `, ..${obj.length - maxKeys}]`
                );
            }
            return (
                '[' +
                obj.map(o => recursivelyTrimAndStringify(o, maxStrLen, maxKeys)).join(', ') +
                ']'
            );
        }
        const objectEntries = Object.entries(obj).map(([k, v]) => [
            k,
            recursivelyTrimAndStringify(v, maxStrLen, maxKeys)
        ]);
        if (objectEntries.length > maxKeys) {
            return (
                '{' +
                objectEntries
                    .slice(0, maxKeys)
                    .map(([k, v]) => ` ${k}: ${v}`)
                    .join(',') +
                `, ..${objectEntries.length - maxKeys} }`
            );
        }
        return '{' + objectEntries.map(([k, v]) => ` ${k}: ${v}`).join(', ') + ' }';
    }
    return obj + '';
}

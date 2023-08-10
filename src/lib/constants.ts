import type { CookieSerializeOptions } from 'cookie';

export const NORMAL_COOKIE_TIMEOUT_DAYS = 1;
export const REMEMBER_ME_COOKIE_TIMEOUT_DAYS = 365;

export const UUID_LEN = 32;

const KEY_PREFIX = '__halcyon_land_';

export const LS_KEYS = {
    newEntryBody: `${KEY_PREFIX}new_entry_body`,
    newEntryTitle: `${KEY_PREFIX}new_entry_title`,
    newEntryLabel: `${KEY_PREFIX}new_entry_label`,
    passcodeLastEntered: `${KEY_PREFIX}passcode_last_entered`,
    enabledLocation: `${KEY_PREFIX}enabled_location`,
    sortEventsKey: `${KEY_PREFIX}events_sort_key`,
    obfuscated: `${KEY_PREFIX}obfuscated`,
    lastTipNumber: `${KEY_PREFIX}last_tip_number`,
    doesNotWantToEnableLocation: `${KEY_PREFIX}does_not_want_to_enable_location`
} as const;

export const SESSION_KEYS = {
    GH_CB: `${KEY_PREFIX}github_callback_state`,
    username: `${KEY_PREFIX}username`,
    encryptionKey: `${KEY_PREFIX}key`
};

export enum Theme {
    light = 'light',
    dark = 'dark'
}

export const COOKIE_KEYS = {
    theme: `${KEY_PREFIX}theme`,
    allowedCookies: `${KEY_PREFIX}allowed_cookies`,
    sessionId: `${KEY_PREFIX}session_id`
} as const;

export const LS_TO_CLEAR_ON_LOGOUT = Object.freeze([
    LS_KEYS.newEntryBody,
    LS_KEYS.newEntryTitle,
    LS_KEYS.newEntryLabel,
    LS_KEYS.passcodeLastEntered,
    LS_KEYS.enabledLocation,
    LS_KEYS.sortEventsKey,
    LS_KEYS.obfuscated,
    LS_KEYS.lastTipNumber,
    LS_KEYS.doesNotWantToEnableLocation
]);
export const SESSION_TO_CLEAR_ON_LOGOUT = Object.freeze([
    SESSION_KEYS.username,
    SESSION_KEYS.encryptionKey,
    SESSION_KEYS.GH_CB
]);
export const COOKIES_TO_CLEAR_ON_LOGOUT = Object.freeze([]);

// possible characters to show when the text is blurred
export const OBFUSCATE_CHARS = 'abcdefghijklmnopqrstuvwxyz ';

interface ICookieOptions {
    rememberMe: boolean;
    httpOnly: boolean;
}

export function maxAgeFromShouldRememberMe(rememberMe: boolean): Seconds {
    const maxAgeDays = rememberMe ? REMEMBER_ME_COOKIE_TIMEOUT_DAYS : NORMAL_COOKIE_TIMEOUT_DAYS;
    return maxAgeDays * 24 * 60 * 60;
}

export function cookieOptions({
    rememberMe,
    httpOnly
}: ICookieOptions): Readonly<CookieSerializeOptions> {
    const maxAge = maxAgeFromShouldRememberMe(rememberMe);
    const expires = new Date(Math.floor(Date.now() / 1000) * 1000 + maxAge * 1000);
    return Object.freeze({
        secure: true,
        path: '/',
        // Needed for GitHub OAuth callback to work smoothly,
        // if set to 'strict' then no cookies are sent to the callback page
        sameSite: 'lax',
        // if true, not readable by client JS
        // https://owasp.org/www-community/HttpOnly
        httpOnly,
        expires,
        maxAge
    });
}

export function sessionCookieOptions(rememberMe: boolean): Readonly<CookieSerializeOptions> {
    return cookieOptions({ httpOnly: true, rememberMe });
}

export const MAX_IMAGE_SIZE: Bytes = 1024 * 1024 * 8; // 8MiB

export const NAVBAR_HEIGHT: Pixels = 60;

export const ANIMATION_DURATION: Milliseconds = 200;

export const API_DOCS_LINK =
    'https://docs.google.com/spreadsheets/d/1eLjbfXnzAXRz08qJPRGnM_IsezMKcuT6anuy_qwP-Uo/edit?usp=sharing';

export const DEBUG_RENDER_COLLIDERS = false;

export const ENABLE_CACHING = true;

export const POLL_FOR_UPDATE_INTERVAL: Milliseconds = 1000 * 20;

export const LOG_FILE_NAME = 'general.log';

export const DEV_USE_TZ_OFFSET_0 = false;

export const FILE_INPUT_ACCEPT_TYPES = 'image/png, image/jpeg, image/jpg, image/webp';

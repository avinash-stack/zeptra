export const LANDING_URL = import.meta.env.VITE_LANDING_URL || '';
export const APP_URL = import.meta.env.VITE_APP_URL || '';

/** True when domains are different and we're on the landing site */
export const isLandingSite = LANDING_URL !== APP_URL && window.location.origin === LANDING_URL;
/** True when domains are different and we're on the app site */
export const isAppSite = LANDING_URL !== APP_URL && window.location.origin === APP_URL;
/** True when landing & app share the same origin (dev mode or misconfiguration) */
export const isSingleOrigin = LANDING_URL === APP_URL || !LANDING_URL || !APP_URL;

/** Build a full URL to the app domain */
export const appUrl = (path: string) => `${APP_URL}${path}`;
/** Build a full URL to the landing domain */
export const landingUrl = (path: string) => `${LANDING_URL}${path}`;

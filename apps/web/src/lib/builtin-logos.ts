// The built-in logos of the software: the fallback of the two logo slots of the branding settings until an operator
// uploads one. They are build assets of the web app (hashed by Vite and served from the app's own origin), not
// instance branding, and not uploads: nothing is stored in the blob store and nothing is read from a setting.
//
// The files are the maintainer's artwork. To change them, replace the two files below (keep the names, or change
// the two imports here); nothing else refers to them.
import light from './assets/scorpion-light.png';
import dark from './assets/scorpion-dark.png';
import favicon from './assets/scorpion-favicon.png';

export const builtInLogos = { light, dark };

/** The mark alone (cropped, without the "Powered by Scorpion" text), square: the icon of the browser tab. */
export const builtInFavicon = favicon;

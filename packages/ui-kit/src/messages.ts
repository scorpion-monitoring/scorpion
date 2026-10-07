// The texts of the shared components: the re-authentication dialog here, the rest in `messages-components.ts`.
// The layout merges them with the shell's and the modules'.
import { mergeBundles, type MessageBundles } from './i18n.ts';
import { componentMessages } from './messages-components.ts';

const reauthMessages: MessageBundles = {
  en: {
    'reauth.title': 'Confirm your identity',
    'reauth.password.lead': 'This change needs a recent sign-in. Enter your password to continue.',
    'reauth.password.label': 'Password',
    'reauth.password.wrong': 'That password is not right.',
    'reauth.throttled.one': 'Too many attempts. Try again in {count} second.',
    'reauth.throttled.other': 'Too many attempts. Try again in {count} seconds.',
    'reauth.throttled.later': 'Too many attempts. Try again later.',
    'reauth.failed': 'Confirming your identity failed. Try again.',
    'reauth.cancel': 'Cancel',
    'reauth.confirm': 'Confirm',
    'reauth.provider.lead':
      'Your account has no password. Sign in again at your provider to continue.',
    'reauth.provider.signIn': 'Sign in again with {name}',
    'reauth.provider.noSignIn': 'Your account has no sign-in at that provider.',
    'reauth.provider.none': 'No sign-in provider is available.',
  },
  de: {
    'reauth.title': 'Identität bestätigen',
    'reauth.password.lead':
      'Diese Änderung erfordert eine aktuelle Anmeldung. Geben Sie zum Fortfahren Ihr Passwort ein.',
    'reauth.password.label': 'Passwort',
    'reauth.password.wrong': 'Dieses Passwort ist nicht richtig.',
    'reauth.throttled.one': 'Zu viele Versuche. Bitte versuchen Sie es in {count} Sekunde erneut.',
    'reauth.throttled.other':
      'Zu viele Versuche. Bitte versuchen Sie es in {count} Sekunden erneut.',
    'reauth.throttled.later': 'Zu viele Versuche. Bitte versuchen Sie es später erneut.',
    'reauth.failed': 'Die Bestätigung ist fehlgeschlagen. Bitte versuchen Sie es erneut.',
    'reauth.cancel': 'Abbrechen',
    'reauth.confirm': 'Bestätigen',
    'reauth.provider.lead':
      'Ihr Konto hat kein Passwort. Melden Sie sich zum Fortfahren erneut bei Ihrem Anbieter an.',
    'reauth.provider.signIn': 'Erneut anmelden mit {name}',
    'reauth.provider.noSignIn': 'Ihr Konto hat bei diesem Anbieter keine Anmeldung.',
    'reauth.provider.none': 'Es ist kein Anmeldeanbieter verfügbar.',
  },
};

/** Every text of the shared components. */
export const uiKitMessages: MessageBundles = mergeBundles([reauthMessages, componentMessages]);

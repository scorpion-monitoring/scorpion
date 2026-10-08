import type { UiMessages } from '@scorpion/contracts';
import { mergeBundles } from '@scorpion/ui-kit/i18n';
import { adminMessages } from './admin/messages.ts';

// The texts of the sign-in, registration, recovery and profile pages. Keys are prefixed with the page.
// A text that depends on a number has one key per plural form (`login.throttled.one`, `.other`).
const accountMessages: UiMessages = {
  en: {
    'nav.section.account': 'Account',
    'nav.profile': 'Profile',

    'login.title': 'Sign in',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.or': 'or',
    'login.withProvider': 'Sign in with {name}',
    'login.forgot': 'Forgot your password?',
    'login.register': 'Create an account',
    'login.failed': 'The username or password is wrong.',
    'login.throttled.one': 'Too many failed attempts. Try again in {count} second.',
    'login.throttled.other': 'Too many failed attempts. Try again in {count} seconds.',
    'login.throttled.later': 'Too many failed attempts. Try again later.',
    'login.localOff': 'This instance does not sign people in with a password.',
    'login.network': 'The service could not be reached. Check your connection and try again.',
    'login.error': 'Signing in failed. Try again.',
    'login.providerFailed': 'The sign-in provider could not be reached. Try again later.',
    'login.alreadySignedIn': 'You are signed in as {name}.',
    'login.goHome': 'Go to the start page',
    'login.notice.checkMail':
      'If an account already uses the address your provider gave us, its owner has been sent a message with a link. Nobody was signed in.',
    'login.notice.passwordChanged': 'Your password was changed. Sign in again with the new one.',
    'login.notice.signedOut': 'You were signed out.',
    'login.oidcError.account-pending':
      'Your account is waiting for approval. You are told by mail when an administrator has looked at it.',
    'login.oidcError.state-invalid': 'This sign-in link is not valid or has expired. Start again.',
    'login.oidcError.provider-denied': 'The sign-in at the provider was not completed. Try again.',
    'login.oidcError.provider-unavailable':
      'The sign-in provider could not be reached or answered unexpectedly. Try again later.',
    'login.oidcError.verification-failed':
      'The answer of the sign-in provider could not be verified. Try again.',
    'login.oidcError.not-allowed': 'This account may not sign in.',
    'login.oidcError.already-linked': 'This sign-in is already linked to an account.',

    'pending.title': 'Your account is waiting for approval',
    'pending.body':
      'The password is right, but an administrator has not approved your account yet. You can sign in as soon as they have; you will be told by mail.',
    'pending.contact': 'Questions? Write to {contact}.',
    'pending.home': 'Go to the start page',

    'register.title': 'Create an account',
    'register.lead': 'An administrator approves new accounts. You can sign in after they have.',
    'register.username': 'Username',
    'register.email': 'Email address',
    'register.password': 'Password',
    'register.passwordHint': 'At least 8 characters. A long sentence is a good password.',
    'register.submit': 'Create the account',
    'register.haveAccount': 'Already have an account?',
    'register.login': 'Sign in',
    'register.usernameTaken': 'That username is taken. Choose another one.',
    'register.localOff': 'This instance does not take new accounts with a password.',
    'register.throttled.one': 'Too many requests. Try again in {count} second.',
    'register.throttled.other': 'Too many requests. Try again in {count} seconds.',
    'register.throttled.later': 'Too many requests. Try again later.',
    'register.network': 'The service could not be reached. Check your connection and try again.',
    'register.done.title': 'Check your mail',
    'register.done.body':
      'We have sent a message to the address you gave. If it can be used for a new account, the message tells you what happens next.',
    'register.done.approval':
      'An administrator has to approve a new account before you can sign in.',
    'register.done.login': 'Go to the sign-in page',

    'forgot.title': 'Forgot your password?',
    'forgot.lead':
      'Enter your email address. If an account uses it, we send a link to choose a new password.',
    'forgot.email': 'Email address',
    'forgot.submit': 'Send the link',
    'forgot.done':
      'If an account uses that address, a message with a link is on its way. The link works for 10 minutes.',
    'forgot.back': 'Back to the sign-in page',
    'forgot.localOff': 'This instance does not sign people in with a password.',
    'forgot.throttled': 'Too many requests. Try again later.',
    'forgot.error': 'The request failed. Try again.',

    'reset.title': 'Choose a new password',
    'reset.lead': 'Enter the new password for your account.',
    'reset.password': 'New password',
    'reset.submit': 'Set the password',
    'reset.done':
      'Your password was changed and every session of the account was ended. You can sign in now.',
    'reset.login': 'Go to the sign-in page',
    'reset.expired':
      'This link is not valid, was already used, or has expired (a link works for 10 minutes). Ask for a new one.',
    'reset.askAgain': 'Ask for a new link',
    'reset.localOff': 'This instance does not sign people in with a password.',
    'reset.throttled': 'Too many attempts. Try again later.',
    'reset.network': 'The service could not be reached. Check your connection and try again.',

    'verify.title': 'Confirm your email address',
    'verify.working': 'Confirming your address …',
    'verify.done': 'Your email address is confirmed.',
    'verify.invalid':
      'This link is not valid, was already used, or has expired. Ask for a new confirmation mail on your profile page.',
    'verify.failed': 'The address could not be confirmed. Try the link again in a moment.',
    'verify.login': 'Go to the sign-in page',
    'verify.profile': 'Go to your profile',

    'link.title': 'Connect a sign-in provider',
    'link.checking': 'Checking the link …',
    'link.lead':
      'A mail told you that someone signed in with a provider using your address. Confirm to connect that provider to your account, so that you can use it to sign in. Do nothing if this was not you.',
    'link.confirm': 'Connect the provider',
    'link.done': '{name} is connected to your account. You can use it to sign in.',
    'link.taken': 'That sign-in is already connected to an account.',
    'link.invalid': 'This link is not valid, was already used, or has expired.',
    'link.failed': 'The provider could not be connected. Try again in a moment.',
    'link.retry': 'Try again',
    'link.profile': 'Go to your profile',

    'first.title': 'Set up the first administrator',
    'first.lead':
      'This instance has no administrator yet. Create the first one here; this page is gone afterwards.',
    'first.token.lead':
      'The one-time token was printed once on the standard error of the server when it started (it works for one hour). If it has expired, restart the server or run the create-admin command instead.',
    'first.token': 'One-time token',
    'first.username': 'Username',
    'first.email': 'Email address',
    'first.password': 'Password',
    'first.submit': 'Create the administrator',
    'first.tokenInvalid':
      'The token is not valid: it is unknown, was already used, or has expired. Restart the server for a new one, or run the create-admin command.',
    'first.taken': 'That username or email address is already taken. The token is not used up.',
    'first.throttled': 'Too many attempts. Try again later.',
    'first.network': 'The service could not be reached. Check your connection and try again.',

    'profile.title': 'Your profile',
    'profile.network': 'The service could not be reached. Check your connection and try again.',

    'profile.details.title': 'Details',
    'profile.details.username': 'Username',
    'profile.details.roles': 'Roles',
    'profile.details.displayName': 'Display name',
    'profile.details.email': 'Email address',
    'profile.details.bio': 'About you',
    'profile.details.bioHint': 'Plain text. It is shown as written.',
    'profile.details.save': 'Save',
    'profile.details.saved': 'Saved.',
    'profile.details.throttled': 'You asked for too many address changes. Try again later.',
    'profile.details.pendingEmail':
      'A confirmation was mailed to {email}. Your address changes when you open the link in that message.',
    'profile.details.unverified': 'Your email address is not confirmed yet.',
    'profile.details.resend': 'Send the confirmation again',
    'profile.details.resent': 'A confirmation mail is on its way.',
    'profile.details.alreadyConfirmed': 'The address is already confirmed.',
    'profile.details.resendFailed': 'The mail could not be sent. Try again later.',

    'profile.avatar.title': 'Picture',
    'profile.avatar.alt': 'Picture of {name}',
    'profile.avatar.none': 'You have not set a picture.',
    'profile.avatar.choose': 'Choose a picture',
    'profile.avatar.remove': 'Remove the picture',
    'profile.avatar.hint':
      'PNG, JPEG, WebP, GIF or SVG. The server checks the file and stores its own copy; this is the copy shown above.',
    'profile.avatar.tooBig.one': 'The picture may be at most {count} megabyte.',
    'profile.avatar.tooBig.other': 'The picture may be at most {count} megabytes.',
    'profile.avatar.refusedSize': 'The file is larger than the server accepts.',
    'profile.avatar.refused': 'The server refused the file. Choose another image.',

    'profile.prefs.title': 'Preferences',
    'profile.prefs.locale': 'Language',
    'profile.prefs.locale.browser': 'As my browser says',
    'profile.prefs.locale.en': 'English',
    'profile.prefs.locale.de': 'Deutsch',
    'profile.prefs.localeHint': 'The language of this application and of the mail you receive.',
    'profile.prefs.themeHint':
      'The colour theme is chosen with the buttons in the header and is kept in this browser only.',
    'profile.prefs.save': 'Save',
    'profile.prefs.saved': 'Saved.',
    'profile.prefs.failed': 'The preference could not be saved. Try again.',

    'profile.password.title': 'Password',
    'profile.password.lead':
      'Changing it ends every session of your account, this one included; you sign in again with the new password.',
    'profile.password.current': 'Current password',
    'profile.password.new': 'New password',
    'profile.password.submit': 'Change the password',
    'profile.password.none':
      'Your account signs in through a provider and has no password to change.',
    'profile.password.localOff': 'This instance does not sign people in with a password.',
    'profile.password.throttled.one': 'Too many attempts. Try again in {count} second.',
    'profile.password.throttled.other': 'Too many attempts. Try again in {count} seconds.',
    'profile.password.throttled.later': 'Too many attempts. Try again later.',

    'profile.providers.title': 'Sign-in providers',
    'profile.providers.none': 'No sign-in provider is set up on this instance.',
    'profile.providers.lead':
      'Connect a provider to your account to sign in with it. You will be asked to confirm your identity first.',
    'profile.providers.link': 'Connect {name}',
    'profile.providers.failed': 'The provider could not be reached. Try again later.',
    'profile.providers.unknown': 'That provider is not set up on this instance.',

    'profile.tokens.title': 'Access tokens',
    'profile.tokens.lead':
      'A token lets a program use the API as you, limited to the permissions you tick. Keep it secret.',
    'profile.tokens.empty': 'You have no access tokens.',
    'profile.tokens.name': 'Name',
    'profile.tokens.prefix': 'Starts with',
    'profile.tokens.scopes': 'Permissions',
    'profile.tokens.scopesHint':
      'A token can do only what you tick here, and only what you may do.',
    'profile.tokens.expires': 'Expires',
    'profile.tokens.expiresOn': 'Expires on (optional)',
    'profile.tokens.expiresHint':
      'The token stops working at the end of that day. Leave it empty for no expiry.',
    'profile.tokens.never': 'Never',
    'profile.tokens.lastUsed': 'Last used',
    'profile.tokens.unused': 'Not used yet',
    'profile.tokens.actions': 'Actions',
    'profile.tokens.new': 'Create a token',
    'profile.tokens.create': 'Create the token',
    'profile.tokens.rotate': 'Replace',
    'profile.tokens.rotateNamed': 'Replace the token {name}',
    'profile.tokens.revoke': 'Revoke',
    'profile.tokens.revokeNamed': 'Revoke the token {name}',
    'profile.tokens.confirm': 'Really revoke',
    'profile.tokens.confirmRevoke': 'Really revoke the token {name}',
    'profile.tokens.cancel': 'Cancel',
    'profile.tokens.conflict': 'A token of that name exists, or you have too many tokens.',
    'profile.tokens.secretTitle': 'The token {name} is ready',
    'profile.tokens.secretWarning':
      'This is the only time it is shown. Copy it now; it cannot be shown again.',
    'profile.tokens.copy': 'Copy',
    'profile.tokens.copied': 'Copied.',
    'profile.tokens.copyFailed': 'Copying failed. Select the token and copy it by hand.',
    'profile.tokens.dismiss': 'I have copied it',

    'profile.sessions.title': 'Sessions',
    'profile.sessions.lead':
      'The places you are signed in. Ending a session or all of them asks you to confirm your identity first.',
    'profile.sessions.started': 'Started',
    'profile.sessions.lastSeen': 'Last used',
    'profile.sessions.actions': 'Actions',
    'profile.sessions.current': 'This session',
    'profile.sessions.end': 'End',
    'profile.sessions.endCurrent': 'Sign out here',
    'profile.sessions.endAll': 'Sign out everywhere',
    'profile.sessions.failed': 'The session could not be ended. Try again.',
  },
  de: {
    'nav.section.account': 'Konto',
    'nav.profile': 'Profil',

    'login.title': 'Anmelden',
    'login.username': 'Benutzername',
    'login.password': 'Passwort',
    'login.submit': 'Anmelden',
    'login.or': 'oder',
    'login.withProvider': 'Mit {name} anmelden',
    'login.forgot': 'Passwort vergessen?',
    'login.register': 'Konto erstellen',
    'login.failed': 'Benutzername oder Passwort sind falsch.',
    'login.throttled.one':
      'Zu viele fehlgeschlagene Versuche. Bitte in {count} Sekunde erneut versuchen.',
    'login.throttled.other':
      'Zu viele fehlgeschlagene Versuche. Bitte in {count} Sekunden erneut versuchen.',
    'login.throttled.later': 'Zu viele fehlgeschlagene Versuche. Bitte später erneut versuchen.',
    'login.localOff': 'Diese Instanz meldet nicht mit Passwort an.',
    'login.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    'login.error': 'Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.',
    'login.providerFailed':
      'Der Anmeldeanbieter ist nicht erreichbar. Bitte versuchen Sie es später erneut.',
    'login.alreadySignedIn': 'Sie sind angemeldet als {name}.',
    'login.goHome': 'Zur Startseite',
    'login.notice.checkMail':
      'Wenn ein Konto bereits die Adresse nutzt, die Ihr Anbieter uns genannt hat, wurde dessen Inhaber eine Nachricht mit einem Link gesendet. Es wurde niemand angemeldet.',
    'login.notice.passwordChanged':
      'Ihr Passwort wurde geändert. Melden Sie sich mit dem neuen Passwort erneut an.',
    'login.notice.signedOut': 'Sie wurden abgemeldet.',
    'login.oidcError.account-pending':
      'Ihr Konto wartet auf Freigabe. Sie erfahren per E-Mail, wenn eine Administratorin oder ein Administrator es geprüft hat.',
    'login.oidcError.state-invalid':
      'Dieser Anmeldelink ist ungültig oder abgelaufen. Beginnen Sie von vorn.',
    'login.oidcError.provider-denied':
      'Die Anmeldung beim Anbieter wurde nicht abgeschlossen. Bitte versuchen Sie es erneut.',
    'login.oidcError.provider-unavailable':
      'Der Anmeldeanbieter war nicht erreichbar oder hat unerwartet geantwortet. Bitte versuchen Sie es später erneut.',
    'login.oidcError.verification-failed':
      'Die Antwort des Anmeldeanbieters konnte nicht geprüft werden. Bitte versuchen Sie es erneut.',
    'login.oidcError.not-allowed': 'Dieses Konto darf sich nicht anmelden.',
    'login.oidcError.already-linked': 'Diese Anmeldung ist bereits mit einem Konto verknüpft.',

    'pending.title': 'Ihr Konto wartet auf Freigabe',
    'pending.body':
      'Das Passwort ist richtig, aber ein Administrator hat Ihr Konto noch nicht freigegeben. Sie können sich anmelden, sobald das geschehen ist; Sie erfahren es per E-Mail.',
    'pending.contact': 'Fragen? Schreiben Sie an {contact}.',
    'pending.home': 'Zur Startseite',

    'register.title': 'Konto erstellen',
    'register.lead':
      'Ein Administrator gibt neue Konten frei. Sie können sich anmelden, sobald das geschehen ist.',
    'register.username': 'Benutzername',
    'register.email': 'E-Mail-Adresse',
    'register.password': 'Passwort',
    'register.passwordHint': 'Mindestens 8 Zeichen. Ein langer Satz ist ein gutes Passwort.',
    'register.submit': 'Konto erstellen',
    'register.haveAccount': 'Sie haben schon ein Konto?',
    'register.login': 'Anmelden',
    'register.usernameTaken': 'Dieser Benutzername ist vergeben. Bitte wählen Sie einen anderen.',
    'register.localOff': 'Diese Instanz nimmt keine neuen Konten mit Passwort an.',
    'register.throttled.one': 'Zu viele Anfragen. Bitte in {count} Sekunde erneut versuchen.',
    'register.throttled.other': 'Zu viele Anfragen. Bitte in {count} Sekunden erneut versuchen.',
    'register.throttled.later': 'Zu viele Anfragen. Bitte später erneut versuchen.',
    'register.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    'register.done.title': 'Prüfen Sie Ihr Postfach',
    'register.done.body':
      'Wir haben eine Nachricht an die angegebene Adresse gesendet. Wenn sie für ein neues Konto verwendet werden kann, steht darin, wie es weitergeht.',
    'register.done.approval':
      'Ein Administrator muss ein neues Konto freigeben, bevor Sie sich anmelden können.',
    'register.done.login': 'Zur Anmeldeseite',

    'forgot.title': 'Passwort vergessen?',
    'forgot.lead':
      'Geben Sie Ihre E-Mail-Adresse ein. Wenn ein Konto sie nutzt, senden wir einen Link zum Festlegen eines neuen Passworts.',
    'forgot.email': 'E-Mail-Adresse',
    'forgot.submit': 'Link senden',
    'forgot.done':
      'Wenn ein Konto diese Adresse nutzt, ist eine Nachricht mit einem Link unterwegs. Der Link gilt 10 Minuten.',
    'forgot.back': 'Zurück zur Anmeldeseite',
    'forgot.localOff': 'Diese Instanz meldet nicht mit Passwort an.',
    'forgot.throttled': 'Zu viele Anfragen. Bitte später erneut versuchen.',
    'forgot.error': 'Die Anfrage ist fehlgeschlagen. Bitte versuchen Sie es erneut.',

    'reset.title': 'Neues Passwort festlegen',
    'reset.lead': 'Geben Sie das neue Passwort für Ihr Konto ein.',
    'reset.password': 'Neues Passwort',
    'reset.submit': 'Passwort festlegen',
    'reset.done':
      'Ihr Passwort wurde geändert und alle Sitzungen des Kontos wurden beendet. Sie können sich jetzt anmelden.',
    'reset.login': 'Zur Anmeldeseite',
    'reset.expired':
      'Dieser Link ist ungültig, wurde schon benutzt oder ist abgelaufen (ein Link gilt 10 Minuten). Fordern Sie einen neuen an.',
    'reset.askAgain': 'Neuen Link anfordern',
    'reset.localOff': 'Diese Instanz meldet nicht mit Passwort an.',
    'reset.throttled': 'Zu viele Versuche. Bitte später erneut versuchen.',
    'reset.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',

    'verify.title': 'E-Mail-Adresse bestätigen',
    'verify.working': 'Adresse wird bestätigt …',
    'verify.done': 'Ihre E-Mail-Adresse ist bestätigt.',
    'verify.invalid':
      'Dieser Link ist ungültig, wurde schon benutzt oder ist abgelaufen. Fordern Sie auf Ihrer Profilseite eine neue Bestätigungs-Mail an.',
    'verify.failed':
      'Die Adresse konnte nicht bestätigt werden. Versuchen Sie den Link in einem Moment erneut.',
    'verify.login': 'Zur Anmeldeseite',
    'verify.profile': 'Zu Ihrem Profil',

    'link.title': 'Anmeldeanbieter verbinden',
    'link.checking': 'Link wird geprüft …',
    'link.lead':
      'Eine E-Mail hat Ihnen mitgeteilt, dass sich jemand mit einem Anbieter und Ihrer Adresse angemeldet hat. Bestätigen Sie, um diesen Anbieter mit Ihrem Konto zu verbinden, damit Sie sich damit anmelden können. Tun Sie nichts, wenn Sie das nicht waren.',
    'link.confirm': 'Anbieter verbinden',
    'link.done': '{name} ist mit Ihrem Konto verbunden. Sie können sich damit anmelden.',
    'link.taken': 'Diese Anmeldung ist bereits mit einem Konto verbunden.',
    'link.invalid': 'Dieser Link ist ungültig, wurde schon benutzt oder ist abgelaufen.',
    'link.failed':
      'Der Anbieter konnte nicht verbunden werden. Bitte versuchen Sie es in einem Moment erneut.',
    'link.retry': 'Erneut versuchen',
    'link.profile': 'Zu Ihrem Profil',

    'first.title': 'Ersten Administrator einrichten',
    'first.lead':
      'Diese Instanz hat noch keinen Administrator. Legen Sie hier den ersten an; danach verschwindet diese Seite.',
    'first.token.lead':
      'Das Einmal-Token wurde beim Start des Servers einmalig auf der Standardfehlerausgabe angezeigt (es gilt eine Stunde). Ist es abgelaufen, starten Sie den Server neu oder führen Sie stattdessen den Befehl create-admin aus.',
    'first.token': 'Einmal-Token',
    'first.username': 'Benutzername',
    'first.email': 'E-Mail-Adresse',
    'first.password': 'Passwort',
    'first.submit': 'Administrator anlegen',
    'first.tokenInvalid':
      'Das Token ist ungültig: unbekannt, schon benutzt oder abgelaufen. Starten Sie den Server für ein neues neu oder führen Sie den Befehl create-admin aus.',
    'first.taken':
      'Dieser Benutzername oder diese E-Mail-Adresse ist schon vergeben. Das Token ist nicht verbraucht.',
    'first.throttled': 'Zu viele Versuche. Bitte später erneut versuchen.',
    'first.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',

    'profile.title': 'Ihr Profil',
    'profile.network':
      'Der Dienst ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',

    'profile.details.title': 'Angaben',
    'profile.details.username': 'Benutzername',
    'profile.details.roles': 'Rollen',
    'profile.details.displayName': 'Anzeigename',
    'profile.details.email': 'E-Mail-Adresse',
    'profile.details.bio': 'Über Sie',
    'profile.details.bioHint': 'Reiner Text. Er wird so angezeigt, wie er geschrieben ist.',
    'profile.details.save': 'Speichern',
    'profile.details.saved': 'Gespeichert.',
    'profile.details.throttled':
      'Sie haben zu viele Adressänderungen angefordert. Bitte später erneut versuchen.',
    'profile.details.pendingEmail':
      'Eine Bestätigung wurde an {email} gesendet. Ihre Adresse ändert sich, wenn Sie den Link in dieser Nachricht öffnen.',
    'profile.details.unverified': 'Ihre E-Mail-Adresse ist noch nicht bestätigt.',
    'profile.details.resend': 'Bestätigung erneut senden',
    'profile.details.resent': 'Eine Bestätigungs-Mail ist unterwegs.',
    'profile.details.alreadyConfirmed': 'Die Adresse ist bereits bestätigt.',
    'profile.details.resendFailed':
      'Die Mail konnte nicht gesendet werden. Bitte später erneut versuchen.',

    'profile.avatar.title': 'Bild',
    'profile.avatar.alt': 'Bild von {name}',
    'profile.avatar.none': 'Sie haben kein Bild festgelegt.',
    'profile.avatar.choose': 'Bild auswählen',
    'profile.avatar.remove': 'Bild entfernen',
    'profile.avatar.hint':
      'PNG, JPEG, WebP, GIF oder SVG. Der Server prüft die Datei und speichert eine eigene Kopie; diese Kopie sehen Sie oben.',
    'profile.avatar.tooBig.one': 'Das Bild darf höchstens {count} Megabyte groß sein.',
    'profile.avatar.tooBig.other': 'Das Bild darf höchstens {count} Megabyte groß sein.',
    'profile.avatar.refusedSize': 'Die Datei ist größer, als der Server annimmt.',
    'profile.avatar.refused': 'Der Server hat die Datei abgelehnt. Wählen Sie ein anderes Bild.',

    'profile.prefs.title': 'Einstellungen',
    'profile.prefs.locale': 'Sprache',
    'profile.prefs.locale.browser': 'Wie mein Browser',
    'profile.prefs.locale.en': 'English',
    'profile.prefs.locale.de': 'Deutsch',
    'profile.prefs.localeHint': 'Die Sprache dieser Anwendung und der E-Mails, die Sie erhalten.',
    'profile.prefs.themeHint':
      'Das Farbschema wählen Sie mit den Schaltflächen in der Kopfzeile; es wird nur in diesem Browser gespeichert.',
    'profile.prefs.save': 'Speichern',
    'profile.prefs.saved': 'Gespeichert.',
    'profile.prefs.failed':
      'Die Einstellung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.',

    'profile.password.title': 'Passwort',
    'profile.password.lead':
      'Eine Änderung beendet alle Sitzungen Ihres Kontos, auch diese; Sie melden sich mit dem neuen Passwort erneut an.',
    'profile.password.current': 'Aktuelles Passwort',
    'profile.password.new': 'Neues Passwort',
    'profile.password.submit': 'Passwort ändern',
    'profile.password.none':
      'Ihr Konto meldet sich über einen Anbieter an und hat kein Passwort, das geändert werden könnte.',
    'profile.password.localOff': 'Diese Instanz meldet nicht mit Passwort an.',
    'profile.password.throttled.one':
      'Zu viele Versuche. Bitte in {count} Sekunde erneut versuchen.',
    'profile.password.throttled.other':
      'Zu viele Versuche. Bitte in {count} Sekunden erneut versuchen.',
    'profile.password.throttled.later': 'Zu viele Versuche. Bitte später erneut versuchen.',

    'profile.providers.title': 'Anmeldeanbieter',
    'profile.providers.none': 'Auf dieser Instanz ist kein Anmeldeanbieter eingerichtet.',
    'profile.providers.lead':
      'Verbinden Sie einen Anbieter mit Ihrem Konto, um sich damit anzumelden. Zuvor müssen Sie Ihre Identität bestätigen.',
    'profile.providers.link': '{name} verbinden',
    'profile.providers.failed':
      'Der Anbieter ist nicht erreichbar. Bitte versuchen Sie es später erneut.',
    'profile.providers.unknown': 'Dieser Anbieter ist auf dieser Instanz nicht eingerichtet.',

    'profile.tokens.title': 'Zugriffstoken',
    'profile.tokens.lead':
      'Mit einem Token nutzt ein Programm die API als Sie, beschränkt auf die Berechtigungen, die Sie ankreuzen. Halten Sie es geheim.',
    'profile.tokens.empty': 'Sie haben keine Zugriffstoken.',
    'profile.tokens.name': 'Name',
    'profile.tokens.prefix': 'Beginnt mit',
    'profile.tokens.scopes': 'Berechtigungen',
    'profile.tokens.scopesHint':
      'Ein Token kann nur tun, was Sie hier ankreuzen und was Sie selbst dürfen.',
    'profile.tokens.expires': 'Läuft ab',
    'profile.tokens.expiresOn': 'Läuft ab am (optional)',
    'profile.tokens.expiresHint':
      'Das Token funktioniert bis zum Ende dieses Tages. Leer lassen für kein Ablaufdatum.',
    'profile.tokens.never': 'Nie',
    'profile.tokens.lastUsed': 'Zuletzt benutzt',
    'profile.tokens.unused': 'Noch nicht benutzt',
    'profile.tokens.actions': 'Aktionen',
    'profile.tokens.new': 'Token erstellen',
    'profile.tokens.create': 'Token erstellen',
    'profile.tokens.rotate': 'Ersetzen',
    'profile.tokens.rotateNamed': 'Token {name} ersetzen',
    'profile.tokens.revoke': 'Widerrufen',
    'profile.tokens.revokeNamed': 'Token {name} widerrufen',
    'profile.tokens.confirm': 'Wirklich widerrufen',
    'profile.tokens.confirmRevoke': 'Token {name} wirklich widerrufen',
    'profile.tokens.cancel': 'Abbrechen',
    'profile.tokens.conflict':
      'Ein Token mit diesem Namen existiert, oder Sie haben zu viele Token.',
    'profile.tokens.secretTitle': 'Das Token {name} ist bereit',
    'profile.tokens.secretWarning':
      'Nur jetzt wird es angezeigt. Kopieren Sie es jetzt; es kann nicht erneut angezeigt werden.',
    'profile.tokens.copy': 'Kopieren',
    'profile.tokens.copied': 'Kopiert.',
    'profile.tokens.copyFailed':
      'Kopieren fehlgeschlagen. Markieren Sie das Token und kopieren Sie es von Hand.',
    'profile.tokens.dismiss': 'Ich habe es kopiert',

    'profile.sessions.title': 'Sitzungen',
    'profile.sessions.lead':
      'Die Orte, an denen Sie angemeldet sind. Eine Sitzung oder alle zu beenden, erfordert zuvor die Bestätigung Ihrer Identität.',
    'profile.sessions.started': 'Begonnen',
    'profile.sessions.lastSeen': 'Zuletzt benutzt',
    'profile.sessions.actions': 'Aktionen',
    'profile.sessions.current': 'Diese Sitzung',
    'profile.sessions.end': 'Beenden',
    'profile.sessions.endCurrent': 'Hier abmelden',
    'profile.sessions.endAll': 'Überall abmelden',
    'profile.sessions.failed':
      'Die Sitzung konnte nicht beendet werden. Bitte versuchen Sie es erneut.',
  },
};

/** Every text of the pages of this module: the account pages and the administration of users. */
export const messages: UiMessages = mergeBundles([accountMessages, adminMessages]);

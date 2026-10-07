// The texts of the shell itself (layout, error page, theme toggle). Pages of modules bring their own
// (`messages` in their `ui` entry). Keys are prefixed with the area that owns them.
import type { MessageBundles } from '@scorpion/ui-kit';

export const shellMessages: MessageBundles = {
  en: {
    'app.skipToContent': 'Skip to content',
    'app.mainNav': 'Main navigation',
    'app.menu.open': 'Open the menu',
    'app.menu.close': 'Close the menu',
    'app.sidebar.collapse': 'Collapse the sidebar',
    'app.sidebar.expand': 'Expand the sidebar',
    'app.account.menu': 'Account menu',
    'app.account.signedInAs': 'Signed in as {name}',
    'app.account.logout': 'Log out',
    'app.account.loggingOut': 'Logging out…',
    'app.account.logoutFailed': 'Logging out failed. Try again.',
    'app.account.signIn': 'Sign in',
    'app.theme.label': 'Colour theme',
    'app.theme.system': 'System',
    'app.theme.light': 'Light',
    'app.theme.dark': 'Dark',
    'app.footer.legal': 'Legal',
    'app.footer.copyright': '© {year} {name}',
    'app.footer.contact': 'Contact',
    'app.error.title': 'Something went wrong',
    'app.error.403': 'You are not allowed to open this page.',
    'app.error.404': 'This page does not exist.',
    'app.error.requestId': 'Reference: {id}',
    'app.error.home': 'Go home',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
  },
};

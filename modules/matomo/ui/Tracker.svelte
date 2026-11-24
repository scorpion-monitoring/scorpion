<script lang="ts">
  // The usage tracker (ADR-0054). Draws nothing. It asks the server once whether tracking is on, loads matomo.js from the
  // configured Matomo (the page's CSP allows that one origin only while tracking is on) and sends one page view per page
  // the person opens: the page's pattern, never its address. A browser that asks not to be tracked sends nothing.
  import { onMount } from 'svelte';
  import { getShell } from '@scorpion/ui-kit';
  import { unwrap } from '@scorpion/contracts/client';
  import {
    asksNotToBeTracked,
    isNewPageView,
    pageViewCommands,
    setupCommands,
    trackedPath,
    trackedUrl,
    type EnabledTracker,
    type MatomoCommand,
  } from './tracking.ts';

  type Queue = { push: (command: MatomoCommand) => void };
  const { api, href, session, onNavigated } = getShell();

  const queue = (): Queue => {
    const holder = window as unknown as { _paq?: Queue };
    holder._paq ??= [] as unknown as Queue;
    return holder._paq;
  };

  const load = async () => {
    try {
      const config = await unwrap(api.GET('/matomo/tracker'));
      return config.enabled ? config : undefined;
    } catch {
      // No module in this profile, or the server cannot answer: no tracking, and the page carries on.
      return undefined;
    }
  };

  onMount(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void (async () => {
      let config = await load();
      if (gone || !config) return;
      const browser = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (
        config.respectDoNotTrack &&
        asksNotToBeTracked({
          doNotTrack: browser.doNotTrack,
          windowDoNotTrack: (window as { doNotTrack?: string | null }).doNotTrack,
          globalPrivacyControl: browser.globalPrivacyControl,
        })
      ) {
        return;
      }

      for (const command of setupCommands(config)) queue().push(command);
      const script = document.createElement('script');
      script.async = true;
      script.src = `${config.url}matomo.js`;
      document.head.append(script);

      let previousPathname: string | undefined;
      let previousUrl: string | undefined;
      let sentUserId = false;
      let person = session()?.user.id ?? null;
      stop = onNavigated((page) => {
        if (!isNewPageView(previousPathname, page)) return;
        previousPathname = page.pathname;
        const url = trackedUrl(location.origin, href, page);
        const send = (current: EnabledTracker) => {
          for (const command of pageViewCommands({
            url,
            title: trackedPath(page),
            previousUrl,
            userId: current.userId,
            hadUserId: sentUserId,
          })) {
            queue().push(command);
          }
          sentUserId = current.userId !== undefined;
          previousUrl = url;
        };
        const now = session()?.user.id ?? null;
        if (now === person) {
          send(config!);
          return;
        }
        // Somebody signed in or out: the pseudonymous id is the server's to give, so it is asked again first.
        person = now;
        void load().then((fresh) => {
          if (gone || !fresh) return;
          config = fresh;
          send(fresh);
        });
      });
    })();
    return () => {
      gone = true;
      stop?.();
    };
  });
</script>

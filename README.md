# usage-hud

A Claude Code mod that shows your plan usage and prompt cache state while you work:

- 5-hour window: bar, percent left, time until reset
- 7-day window: bar, percent left, time until reset
- Prompt cache: hot with time left (bar drains toward cold), or cold

It draws a one-line strip above the message box. Type `/usage-hud` to print the same readout as text.

```
5h [##########] 98% 2h 56m  |  7d [##########] 100% 6d 23h  |  Cache [#########-] hot 52m
```

Bars are green above 50% left, amber from 20% to 50%, red under 20%. Readings older than 10 minutes are dimmed with "as of".

## Look

Option `theme`:

- `clean` (default): in the desktop app, mobile and VS Code the strip is drawn as a minimal card: a quiet dark panel with a large percent-left number for each limit, a thin solid bar (green above 50% left, amber from 20% to 50%, red under 20%) and a small status dot beside each label. No decoration.
- `classic`: the older neutral card with solid green, amber and red bars.
- `midnight`: deep navy glass with a neon accent.
- `paper`: a warm light editorial card.
- `terminal`: monospace phosphor retro.
- `sunset`: warm gradient bars.
- `mono`: ultra-minimal monochrome lines.
- `text`: the text look shown above, everywhere.

The terminal always draws the text look. The strip is drawn in dark colours (the app does not tell a mod whether it is in light or dark mode). It shows whole minutes and redraws at most once a minute; only the text look counts down seconds in the last 10 minutes of the cache.

Set it with `/plugin configure usage-hud@cj-mods` in a terminal session.

Changed in 0.4.0: the default look changed from `christmas` to `clean`, and the festive `christmas` look was removed. A saved value of `christmas` now falls back to the default look (`clean`). The docked pane was removed too: the mod now shows only the strip above the message box, and `/usage-hud` only prints the readout as text.

## Install

Needs Claude Code with mod support (tested on 2.1.309 and 2.1.316) and a Claude subscription (rate limits are not reported on API keys).

From a terminal (PowerShell, bash or zsh):

```
claude plugin marketplace add luckyajinn/usage-hud
claude plugin install usage-hud@cj-mods --scope user
```

Or in the Claude desktop app: click + next to the prompt box, then Plugins, Add marketplace with `luckyajinn/usage-hud`, then add usage-hud.

Then start a new session. In the desktop app, use a local Code session.

## Where it shows

| Where | Shows |
|---|---|
| Terminal (`claude`) | Text strip above the prompt |
| Desktop app, local Code session | Strip above the message box |
| Cloud session (claude.ai/code or viewed in the desktop app) | Installs and runs, but nothing is shown today (see Cloud sessions) |

## Cloud sessions

Short version: it installs and runs in a cloud session, but the strip does not show there today.

Why: mods draw only on a screen that is connected to the session (a terminal, or the desktop app running a local Code session). When you open a cloud session in the desktop app or on claude.ai/code, the app does not connect its screen to that session for mods, so there is nothing to draw on. This is a limit of the app, not of this mod; other mods (for example ribbon) behave the same way.

| In a cloud session | Status |
|---|---|
| Install from the setup script | Works (tested) |
| Mod loads and tracks usage and cache | Works (tested) |
| Strip above the message box | Not shown today |
| `/usage-hud` text readout | Not tested yet |

To install it in every new cloud session, add these two lines to your cloud environment's setup script (environment settings, Setup script):

```
claude plugin marketplace add luckyajinn/usage-hud
claude plugin install usage-hud@cj-mods --scope user
```

Ready for later: if the app starts connecting its screen to cloud sessions, the mod notices the moment that happens and the strip draws there, with no update needed.

## Cache estimate

No API reports the prompt cache directly. The mod stamps the start of each main-thread request that read or wrote the cache, and counts down the cache lifetime per chat. The lifetime defaults to 1 hour. Option `cacheTtl`:

- `auto` (default): 1 hour, changed when Claude Code itself reports a different lifetime (on a model switch, or on resume)
- `5m` or `1h`: forced

Set it with `/plugin configure usage-hud@cj-mods` in a terminal session.

## Updating

```
claude plugin marketplace update cj-mods
claude plugin update usage-hud@cj-mods
```

Then start a new session.

## Uninstall

```
claude plugin uninstall usage-hud@cj-mods --scope user
claude plugin marketplace remove cj-mods
```

## Notes

- The mod API is early access. If a Claude Code update changes the hooks, the mod draws nothing rather than wrong numbers.
- It stores only the last rate-limit reading (kind, percent used, reset time) and the learned cache lifetime, on your machine. No network calls, no file access.

## Development

```
claude plugin validate .
claude plugin test .
```

MIT license. Idea credit: ribbon by RoboNuggets (see NOTICE).

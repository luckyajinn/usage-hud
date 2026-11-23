# usage-hud

A Claude Code mod that shows your plan usage and prompt cache state while you work:

- 5-hour window: bar, percent left (or used), time until reset
- 7-day window: bar, percent left (or used), time until reset
- Prompt cache: hot with time left (bar drains toward cold), or cold

It draws a one-line strip above the message box. Type `/usage-hud` to print the same readout as text.

```
5h [##########] 98% 2h 56m  |  7d [##########] 100% 6d 23h  |  Cache [#########-] hot 52m
```

Bars are green above 50% left, amber from 20% to 50%, red under 20%. Readings older than 10 minutes are dimmed.

## Look

Option `theme`:

- `terminal` (default): a monospace phosphor strip: a near-black panel with faint scanlines, prompt-style labels (`5h>`, `7d>`, `cache>`) and bars made of blocks like `[#######---]`; green above 50% left, amber from 20% to 50%, red under 20%.
- `clean`: a minimal card: a quiet dark panel with a large percent-left number for each limit, a thin solid bar and a small status dot beside each label. No decoration.
- `classic`: the older neutral card with solid green, amber and red bars.
- `midnight`: deep navy glass with a neon accent.
- `paper`: a warm editorial card with serif numerals and ruled-scale bars.
- `sunset`: warm gradient bars on a plum-to-indigo card.
- `mono`: ultra-minimal monochrome, a marker on a hairline instead of a bar.
- `flat`: the quietest look: no card and no bars. One line of text per block (label, number, reset time) with a small coloured dot as the only colour.
- `pips`: ten squares per block, like a battery meter, lit for the amount (or, with `usage` set to `used`, the amount used), then the percent and reset time. The cache squares are red while hot (draining as its time runs out) and all blue when cold.
- `text`: the text look shown above, everywhere.

The terminal always draws the text look. The strip is drawn in dark colours (the app does not tell a mod whether it is in light or dark mode). It shows whole minutes and redraws at most once a minute; only the text look counts down seconds in the last 10 minutes of the cache.

Set it with `/plugin configure usage-hud@cj-mods` in a terminal session.

Changed in 0.4.0: the default look changed from `christmas` to `terminal`, and the festive `christmas` look was removed. A saved value of `christmas` now falls back to the default look (`terminal`). The docked pane was removed too: the mod now shows only the strip above the message box, and `/usage-hud` only prints the readout as text.

Changed in 0.4.1: the strip shows only the time until reset (for example `4h 50m`); the "as of" note is gone, and stale readings are dimmed instead. In midnight, paper, terminal, sunset and mono, the cache text is red while hot and blue when cold.

Changed in 0.5.0: new option `usage` (see Left or used below). Each limit can show its percent left (the default, as before) or its percent used.

Changed in 0.6.0: two new simple looks, `flat` and `pips` (see the list above). The default look is still `terminal`.

Changed in 0.6.1: `pips` draws bigger squares, and its cache squares are red while hot and all blue when cold.

## Left or used

Option `usage`:

- `remaining` (default): each limit shows how much is left, for example `72%`, and its bar drains as you use it.
- `used`: each limit shows how much is spent, for example `28%`, and its bar fills up as you use it.

The two always add up to 100. The colours stay tied to what is left either way: green above 50% left (under 50% used), amber from 20% to 50% left (50% to 80% used), red under 20% left (over 80% used). The cache always shows time left. `/usage-hud` says `left` or `used` after each percent, and so does the text strip at the widths where the word fits.

```
5h [###-------] 28% 2h 14m  |  7d [######----] 60% 3d 4h  |  Cache [#######---] hot 41m
```

Set it with `/plugin configure usage-hud@cj-mods` in a terminal session.

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

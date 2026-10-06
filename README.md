# Rapidplay

A local Chrome extension for standard HTML5 video and audio speed control (0.25×–5.00×).

Open the panel from the toolbar or Alt + X after media detection. Choose All Tabs, This Tab, or This Site; customize presets, shortcuts, step size, hue, and opacity. Z/C step speed while the panel is open by default; closed-panel slower/faster shortcuts are initially unset. Preset shortcuts work while the panel is open. The power button pauses control across tabs and resets tracked media to 1×.

## Install locally

1. Open chrome://extensions and enable Developer mode.
2. Choose Load unpacked and select this project's extension folder.
3. Reload existing web tabs. Open a supported media page and click Rapidplay's toolbar icon.

Requires Chrome 111 or later. HTTP/HTTPS pages and supported frames only; Spotify is excluded. Restricted Chrome pages and some custom players cannot be controlled. Browser/player rate limits still apply.

## Data and permissions

One API permission: storage. Automatic HTTP/HTTPS content scripts also grant website access and may produce Chrome's broad read/change warning. No accounts, analytics, remote code, or developer backend. Local preferences persist on this device; speeds, scopes, tab IDs, activity timestamps, and hostnames are session-only. Tab overrides expire after about 30 minutes of inactivity when state is next processed and clear on ordinary reload. See [the privacy policy](https://zeprius.github.io/Rapidplay/privacy/).

Paused mode stops media discovery and playback control. Chrome's site access remains granted; toolbar messages, the local pause preference, and the settings panel still work.

## Publishing

Upload only release/Rapidplay-1.0.0.zip to the Chrome Web Store. Its root contains manifest.json, background.js, content/, shared/, and icons/. Website and store assets are intentionally outside the runtime. Follow [store/PUBLISHING.md](store/PUBLISHING.md) and use [store/LISTING.md](store/LISTING.md).

The static [website](https://zeprius.github.io/Rapidplay/) is served by GitHub Pages from main, /docs. Support: [GitHub Issues](https://github.com/Zeprius/Rapidplay/issues).

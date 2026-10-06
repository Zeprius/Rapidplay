# Rapidplay — Chrome Web Store fields

Language: English (United States). Category: Productivity. Mature content: No.

## Name

Rapidplay

## Summary (also the manifest description)

Control video and audio playback speed. Apply it to all tabs, this tab, or this site. Settings stay on your device.

## Detailed description

Rapidplay lets you control standard HTML5 video and audio playback speed from a compact in-page panel.

Open the panel from the toolbar, including before media is playing. After media is detected, Alt + X also opens it by default. Drag the slider from 0.25x to 5.00x, click a preset, or use your own shortcuts. Pitch preservation is enabled where the browser supports it.

Choose All Tabs, This Tab, or This Site. All Tabs controls the session default; tab and site overrides keep their own rates. This Site matches the top-level page hostname, including embedded media in supported frames. Speeds and site overrides last for the browser session. Tab overrides clear on ordinary reloads, and expire after approximately 30 minutes of inactivity when the extension next handles state. A discarded tab can preserve its override when restored.

Customize preset speeds and their shortcuts, panel-toggle and slower/faster shortcuts, step size, opacity, and hue. Z and C step speed while the panel is open by default. Preset shortcuts work while the panel is open. Slower/faster shortcuts for the closed panel are initially unset; configure them in Settings to show a brief speed toast while controlling playback.

The power button pauses Rapidplay across tabs and returns tracked media to 1x. Media discovery and playback control stop while paused. The toolbar can still open the settings panel. Pausing does not revoke website access. Shortcuts, presets, appearance, and the on/off choice remain in Chrome's local extension storage after the browser is closed.

Rapidplay requests one API permission: storage. Its packaged content scripts also require access to ordinary HTTP/HTTPS pages for automatic media detection and control, so Chrome may display a broad website-access warning. The lightweight detector watches for media while enabled; the controller loads on media detection or a toolbar click, and is released when no media remains and the panel is closed.

No sign-in, analytics, developer backend, or remote executable code. Settings and session hostnames stay on the device and are not sent to the developer. Hostnames, tab IDs, and activity timestamps are used locally to resolve scopes and expire tab overrides. The extension does not save full page URLs, page text, or browsing history.

Requires Chrome 111 or later. Spotify is excluded. Chrome internal pages and the Chrome Web Store cannot be controlled. Some custom players or restricted frames may not work, and players may enforce their own speed limits. Not affiliated with the websites it runs on.

## URLs

Homepage: https://zeprius.github.io/Rapidplay/
Privacy policy: https://zeprius.github.io/Rapidplay/privacy/
Support: https://github.com/Zeprius/Rapidplay/issues

## Single purpose

Control standard HTML5 video and audio playback rate, with user-selected tab/site/session scopes and locally stored playback shortcuts, presets, and panel preferences.

## Storage permission justification

Stores shortcuts, presets, step size, panel appearance, and pause/on state in chrome.storage.local. Stores session playback rates, scopes, top-level page hostnames, tab IDs, tab activity timestamps, and reload flags in chrome.storage.session to apply site/tab rates and expire tab overrides. This state stays on the device and is not transmitted to the developer.

## Website access justification

Packaged content scripts automatically detect and control HTML5 video/audio on ordinary HTTP/HTTPS pages and supported frames, and open the settings panel on a toolbar click. Media sites are not known in advance, so a fixed domain allowlist would prevent the disclosed automatic All Tabs/This Site behavior. Spotify is excluded. While paused, media discovery and playback control stop; the toolbar settings panel, local pause state, and extension messaging remain available. Static content-script matches create this site access without a separate host_permissions field. Page contents and hostnames are not sent off-device.

## Remote code

No. JavaScript, CSS, and defaults are packaged. Dynamic imports and the CSS fetch use chrome-extension URLs only. No remote executable code, eval, or downloaded libraries are used.

## Data usage disclosures

Disclose Website content (local media-element/DOM access) and Web history (session hostnames used for scopes). Do not claim that no user data is handled simply because it stays local. Shortcut events are used only for explicit controls and combination recording; no keystroke logs or activity analytics are recorded. No personally identifiable information, health data, financial/payment data, authentication data, personal communications, or location is collected. Certify the dashboard statements that data is not sold, used outside the single purpose, or used for creditworthiness/lending. The policy describes local storage, retention, pause behavior, website access, and no external sharing.

Google's guidance requires disclosure even for local processing: [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## Images

- store/store-icon-128.png: 128×128 PNG from the chosen Rapidplay icon.
- store/promo-440x280.png: 440×280 PNG brand tile.
- store/screenshots/01-panel-video.png: panel and real 1.50x playback.
- store/screenshots/02-scope-tabs.png: This Tab at 2.00x.
- store/screenshots/03-settings.png: expanded settings.
- store/screenshots/04-hotkey-recording.png: actual shortcut recording.
- store/screenshots/05-hotkey-toast.png: actual closed-panel speed toast.

Screenshots are 1280×800 PNG captures of the installed extension. No promotional video is included because the original video shows outdated assets. A video is optional. Image specifications: [Chrome Web Store images](https://developer.chrome.com/docs/webstore/images).

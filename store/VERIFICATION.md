# Rapidplay 1.0.0 release verification

Verified October 6, 2026 with the real installed extension in Chromium 151, plus source review and the original 33 regression assertions (run against the finalized source from an external test folder). Grok 4.7 High audits were invoked through Cursor CLI; findings were checked by the main agent against source and actual behavior.

## Browser checks

- Real video and recorded audio playback rates and pitch preservation.
- Presets, slider click, exact slower/faster steps, and typing isolation.
- All Tabs, This Tab, and This Site across matching and different hostnames.
- Shortcut recording and visible closed-panel speed toast.
- Power pause/resume across tabs, toolbar access while paused, and safe handling of an unavailable site hostname.
- Removing the 2.50x preset, removing every preset, and adding a preset.
- Session site-speed restoration after reload.
- Cross-host embedded media and return to idle after iframe removal.
- Correct session rate on a page containing 101 media elements.
- 20 no-media panel open/close cycles: after garbage collection, both before and after measured 2 documents, 12 DOM nodes, and 16 JavaScript event listeners. No growth observed.
- No uncaught page errors during these scenarios.
- Website and privacy policy images and layout at 1280px and 390px widths.

## Runtime changes

Coalesced concurrent media registration so large media pages do not exhaust the message rate limit. Guarded late registration replies against controller restarts/removal. Restored the existing toast after panel teardown, and dispose its timer/overlay after it fades. Honor saved preset edits/removal and normalize duplicate preset IDs. Reject site speed writes without a hostname and restore the previous scope after a rejected selection.

The original panel stylesheet is byte-identical. Controls, layout, default shortcuts, appearance, animations, scopes, and playback range remain the same, apart from restoring broken controls. Brand labels and all brand images now use Rapidplay and the user-selected PNG.

## Security and performance review

One API permission (storage); no additional API or host_permissions fields. Static HTTP/HTTPS content-script site access remains and is explicitly disclosed. Runtime code is packaged; the only fetch reads its packaged CSS. No analytics, remote executable code, external communication, background polling intervals, or always-on background permission. The service worker uses events and Chrome may suspend it when idle. Content-script observers and event listeners are used for media discovery/control while enabled; panel and media teardown remove their transient resources.

These checks found no remaining security issue or resource growth in the exercised scenarios. They are bounded verification, not a guarantee for every website, player, Chrome version, or indefinite session. Chrome 111 is the declared minimum; this run used Chromium 151.

## Upload artifact

File: release/Rapidplay-1.0.0.zip
Runtime files: 10 (plus directory entries), manifest at ZIP root.
SHA-256: f85f51b8a55c98ae8fe7e05ae9aa2a991e472680827659ef77077cee05c8183b

All test scripts, profiles, browser downloads, audit logs, and screenshot fixtures remain outside this finalized project.

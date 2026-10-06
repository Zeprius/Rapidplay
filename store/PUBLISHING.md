# Publish Rapidplay 1.0.0

The repository is the finalized publishing project. The original Video Speed Chrome Extension folder is preserved separately.

1. In the Chrome Web Store developer dashboard, use an existing registered publisher account, complete its required contact/account fields, and create a new item. If this is an update to an already published extension, use that existing item's dashboard instead and increase the manifest version before upload.
2. Upload release/Rapidplay-1.0.0.zip. Its root must contain manifest.json directly. Do not upload the whole repository or store/docs folders.
3. Fill the listing and privacy fields from LISTING.md. Provide the 128×128 icon, the 440×280 tile, and the five new screenshots.
4. Use the live homepage and privacy URLs from LISTING.md. The repository hosts the site via GitHub Pages from main, /docs. Confirm they open without a login.
5. Complete distribution and publisher contact fields in the dashboard. Choose the regions and visibility appropriate for your release; the account holder makes these publishing decisions. Do not enter an invented email or store item URL.
6. Review the actual permission display: storage is the single API permission, but broad HTTP/HTTPS content-script access is also disclosed. No tabs, alarms, scripting, background, cookies, history, or separate host_permissions permission is requested.
7. Submit the item for Chrome Web Store review when ready. This preparation does not submit it or guarantee approval. Add the approved store installation URL to the website when available.

## Rebuild the upload ZIP after a runtime change

Run PowerShell from the Rapidplay root:

    New-Item -ItemType Directory -Force -Path release | Out-Null
    Compress-Archive -Path extension\* -DestinationPath release\Rapidplay-1.0.0.zip -Force

Increase the manifest version and ZIP filename for subsequent uploads. The release directory is ignored by Git because the runtime source is already versioned.

## Release contents

- extension/: only packaged runtime scripts, CSS, defaults, manifest, and four PNG icon sizes.
- docs/: static public website, policy, current screenshot, and chosen brand icon.
- store/: upload images and publishing text, including verification/provenance notes and icon source.
- README.md and .gitignore: project usage and publication guidance.

No test scripts, browser profiles, downloaded test browsers, design concepts, old screenshots, old videos, dependencies, or agent logs belong in this project or upload ZIP.

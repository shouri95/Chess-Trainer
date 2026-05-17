# One-Week App Store Release Checklist

## Product Trust

- Drill Mode rejects the original flagged mistake as a solution.
- Dashboard uses a drill queue, not a generic training plan.
- Mistake Lab shows trainable positions before filters.
- First-run flow requires a real Chess.com username or explicit sample mode.
- Saved usernames auto-sync on reopen.

## Native Packaging

- Run `npm run ios:add` once to create the iOS project.
- Run `npm run ios:sync` after web changes.
- If `pod install` or `xcodebuild` fails locally, install CocoaPods and select full Xcode with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- Add production app icon and splash assets in Xcode.
- Set bundle identifier, team, signing, version, build number, and deployment target.
- Archive from Xcode and upload to App Store Connect.

## Compliance

- Publish production privacy policy, terms, and support URLs.
- Complete App Store privacy labels from `docs/app-store/privacy-answers.md`.
- Prepare review notes from `docs/app-store/review-notes.md`.
- Confirm Chess.com public API use is acceptable for the product positioning.

## QA

- Fresh install.
- Reopen with saved Chess.com username and confirm silent sync.
- Chess.com username not found.
- Chess.com rate limit or offline failure.
- Sample mode does not persist as a connected account.
- PGN paste/upload.
- Dashboard, Games, Mistake Lab, Drill Mode, Analysis Board.
- Clear local data.
- iPhone SE, standard iPhone, large iPhone, and iPad layout checks.

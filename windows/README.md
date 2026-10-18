# Team Tour Launcher (Windows)

A WinForms app on .NET Framework 4.8. The built exe is committed at `dist/Team Tour Launcher.exe`
and is what `scripts/build-zips.mjs` zips into the release, so the release job needs no .NET SDK.

After changing anything in this folder (or the icon art), rebuild and commit the exe. From the repo root:

```
docker build -f windows/Dockerfile.build --output type=local,dest=windows/out . && cp "windows/out/Team Tour Launcher.exe" "windows/dist/Team Tour Launcher.exe"
```

The build is byte-deterministic (pinned base images, fixed paths), and the `ci` workflow
rebuilds it and fails with "committed exe is stale" if `dist/` differs.

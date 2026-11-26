# Release flow

From the clean release checkout, run:

```sh
.smithers/node_modules/.bin/smthrs flow start release --repo smithersai/vibelang --data '{"version":"0.0.13"}' --wait
```

The flow checks compiler identity, the registry login, e2e, generated docs and final release notes. It builds binaries, packages them, runs the throwaway Verdaccio rehearsal and dry-runs publication. The `publish` confirmation lists each tarball and digest. Declining ends the run.

For npm two-factor authentication, set `VIBELANG_RELEASE_OTP_FILE` in the worker environment to a private file outside the checkout (mode 0600). Write the current six-digit code there before confirming `otp-1`. The confirmation takes a boolean. Only the publisher subprocess receives the password. A refusal from npm opens another confirmation, up to three rounds. For an account without an OTP, leave the variable unset. This path uses Python 3 to give the existing publisher an empty terminal answer.

Public npm publication deploys the docs before verifying the live site and published installer. Set the optional `registry` input to a non-proxying shadow registry to exercise publication and installer verification there. The optional `repo` and `skip` inputs select the checkout and the package-name exclusions supported by the publisher.

Run the offline suite with `node --test .smithers/flows/release/test/*.test.mjs`. It uses the repository publisher with fixture tarballs and a local npm double.

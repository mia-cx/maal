## Parent PRD

#55

## What to prove

Run the retained-auth-slot release matrix from spec §11.1 on native Safari, iOS Safari, and Android Chrome using the executable harness delivered by #58. This is an external-device proof ticket, not a code redesign.

## Acceptance criteria

- [ ] Alice remains authenticated and independently refreshable after Bob is added through the hosted/custom WorkOS flow on native Safari, iOS Safari, and Android Chrome.
- [ ] Targeted revocation/sign-out of either slot leaves the other slot valid on every target.
- [ ] Every sealed auth cookie is recorded below 4,096 bytes and retains the specified Path, Secure, HttpOnly, SameSite, and host-only behavior.
- [ ] Evidence records browser/OS versions and contains no tokens, raw cookies, passwords, or reusable personal data.
- [ ] Disposable staging users are removed after the proof.

## Blocked by

Retained WorkOS auth-slot implementation (#58) and access to native Safari/iOS/Android devices or a trusted browser-device service.

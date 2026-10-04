---
title: Prove retained WorkOS auth slots
parent: ../map.md
label: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Can v1 retain several real WorkOS users independently without putting credentials in IndexedDB or changing any local profile, sync, or schema contracts?

The auth-slot interface is the architectural boundary. Test Hosted AuthKit first for adding and reauthenticating a second real user without replacing the first user's retained session. If that fails, Maal may own the v1 login UI while using WorkOS's documented password, Magic Auth, OAuth, and SSO APIs. WorkOS remains the canonical user and organization management layer in either case.

Passkeys and Maal-owned WebAuthn ceremonies are deferred beyond v1. Dashboard testing found no usable Hosted AuthKit passkey enrollment or sign-in flow despite the documented feature, but that product gap does not block this rewrite.

V1 permits at most eight simultaneously authenticated slots per browser installation. Signed-out local profiles remain usable and do not count toward that cap.

A forgotten local profile PIN can be reset only after online reauthentication as that WorkOS user. Offline, the PIN cannot be bypassed. The user may instead explicitly remove the profile and its private device data under the separate destructive removal flow.

## Completion

Run the required staging and browser cases in `docs/research/multi-profile-auth.md`. At minimum, prove distinct Alice and Bob sessions, path-selected cookies, targeted refresh/revocation, offline switching, Chrome/Firefox/Safari/iOS behavior, and complete cookie sizes below 4,096 bytes.

If Hosted AuthKit cannot add Bob independently, repeat the proof with a Maal-hosted UI backed by WorkOS's documented authentication APIs. Neither login surface may change the device-local profile identifier, auth-slot interface, WorkOS sealed-session format, or Dexie ownership model.

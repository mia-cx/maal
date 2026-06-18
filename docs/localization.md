# Localization

Maal uses Paraglide for UI copy.

## Message naming

- Add copy to `messages/en.json` first. The generated message functions live in `$lib/paraglide/messages`.
- Use stable domain prefixes instead of component names:
  - `app_` for shell/navigation/shared copy
  - `plan_` for meal planning and schedule copy
  - `menu_` for recipe and menu copy
  - `household_` for household settings, members, invites, and onboarding
  - `settings_` for account/security/billing/MCP settings
  - `billing_` for subscription and checkout copy
- Prefer reusable names (`settings_cancel`, `menu_ingredients`) over component-local one-offs.
- Dynamic copy should use Paraglide parameters, e.g. `m.household_remove_member_description({ name })`, not manual concatenation.

## Adding UI copy

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<Button>{m.settings_save_changes()}</Button>
<Input placeholder={m.menu_recipe_search_placeholder()} />
```

Server responses that are user-visible should also use message functions before returning `fail(...)`, `error(...)`, or JSON payloads.

## Locale resolution policy

Public, auth, legal, and marketing routes keep Paraglide's existing runtime policy: cookie/global/default locale.

Authenticated app routes use the active household locale as the source of truth after household resolution. The server maps BCP-47 household locales such as `fr-CA` or `nl-NL` to supported Paraglide language tags (`fr`, `nl`) and writes the Paraglide locale cookie for app requests. If there is no active household, no household row, or an unsupported locale, Paraglide falls back to its normal/default locale strategy.

Household settings therefore drive both taxonomy/formatting preferences and app UI language for authenticated app surfaces.

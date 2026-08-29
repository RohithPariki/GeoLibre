// Saying *why* a capability-gated menu entry is disabled (issue #1672).
//
// A disabled `DropdownMenuItem` carries `pointer-events-none`, so a native
// `title` tooltip on one can never be hovered: the reason has to be rendered as
// its own line and associated with `aria-describedby`, the way the Project menu
// already explains an unreachable share host. A disabled
// `DropdownMenuSubTrigger` deliberately keeps its pointer events (see
// `@geolibre/ui`'s dropdown-menu), so a submenu trigger can carry the same
// reason as a plain `title` instead of a rendered line — one note per menu
// beats one under each of the ten Whitebox category submenus.
//
// This is not the deployment gate (`deployment-gates.ts`), which *hides* what a
// deployment withheld. A privilege denied by the session's role leaves the entry
// visible and explained, so the user can tell "not allowed" from "not here".

import { DropdownMenuLabel } from "@geolibre/ui";

/** What `useAppCapability` reports: whether a privilege is granted, and why not. */
export interface CapabilityState {
  granted: boolean;
  reason?: string;
}

/**
 * The `aria-describedby` target for capability-disabled entries, or undefined.
 *
 * Undefined when the privilege is granted or carries no reason, because
 * `aria-describedby` only resolves against an element that is actually mounted
 * and `<CapabilityNotice>` renders nothing in those cases.
 *
 * @param id - The dom id the matching `<CapabilityNotice>` renders with.
 * @param capability - The capability state from `useAppCapability`.
 * @returns The id, or undefined when no note will be rendered.
 */
export function capabilityNoticeId(id: string, capability: CapabilityState): string | undefined {
  return !capability.granted && capability.reason ? id : undefined;
}

/**
 * The explanation line for a group of entries a denied privilege disabled.
 *
 * @param props.id - The dom id the disabled entries point at with `aria-describedby`.
 * @param props.capability - The capability state from `useAppCapability`.
 * @returns The note, or null when the privilege is granted or unexplained.
 */
export function CapabilityNotice({ id, capability }: { id: string; capability: CapabilityState }) {
  if (capability.granted || !capability.reason) return null;
  return (
    <DropdownMenuLabel id={id} className="pt-0 text-xs font-normal text-muted-foreground">
      {capability.reason}
    </DropdownMenuLabel>
  );
}

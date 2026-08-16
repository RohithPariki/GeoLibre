import {
  DEFAULT_EDITOR_IDENTITY,
  DEFAULT_EDITOR_TRACKING_CONFIG,
  readStoredAuthorName,
  setStoredAuthorName,
  useAppStore,
  type EditorTrackingConfig,
  type GeoLibreLayer,
} from "@geolibre/core";
import { Input, Label } from "@geolibre/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface EditorTrackingSectionProps {
  layer: GeoLibreLayer;
}

/** The four configurable column names, in the order they are shown. */
const FIELD_KEYS = ["createdByField", "createdAtField", "editedByField", "editedAtField"] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

/** The default name for each configurable column. */
const DEFAULT_NAMES = Object.fromEntries(
  FIELD_KEYS.map((key) => [key, DEFAULT_EDITOR_TRACKING_CONFIG[key]]),
) as Record<FieldKey, string>;

/**
 * Why a set of column names is unusable, or `null` when it is fine. Mirrors the
 * rule `resolveEditorTrackingConfig` enforces, so the panel can report it as a
 * message instead of letting it surface as a throw when a feature is stamped.
 */
function nameProblem(names: Record<FieldKey, string>): "blankName" | "duplicateName" | null {
  const values = FIELD_KEYS.map((key) => names[key].trim());
  if (values.some((value) => value === "")) return "blankName";
  if (new Set(values).size !== values.length) return "duplicateName";
  return null;
}

/**
 * The Editor Tracking section of the layer style panel (ArcGIS Layer
 * Properties → Editor Tracking): maintain who created each feature and when,
 * and who last changed it and when, across every editing path — the geometry
 * editor, attribute edits, the Field Calculator, and Field Collection capture.
 *
 * The four columns are written by the app, so the attribute table shows them
 * but refuses to edit, rename or delete them; renaming happens here, where the
 * configuration that gives them meaning lives.
 */
export function EditorTrackingSection({ layer }: EditorTrackingSectionProps) {
  const { t } = useTranslation();
  const setLayerEditorTracking = useAppStore((s) => s.setLayerEditorTracking);
  const collabActive = useAppStore((s) => s.collaboration.isActive);
  const collabName = useAppStore((s) => s.collaboration.selfName);

  const config = layer.editorTracking;
  const enabled = config?.enabled === true;
  // A live session names its participants, and that name wins over the local
  // one (see pickEditorIdentity), so the field is shown but not editable.
  const sessionIdentity = collabActive && collabName ? collabName : null;

  // Read once per mount: localStorage is not reactive, and this input is the
  // only thing in the panel that writes it.
  const [authorName, setAuthorName] = useState(() => readStoredAuthorName());

  // Field names as typed, so a half-cleared name can be retyped instead of
  // snapping back to its stored value on every keystroke.
  const [drafts, setDrafts] = useState<Record<FieldKey, string> | null>(null);
  const storedNames = useMemo(
    () =>
      Object.fromEntries(
        FIELD_KEYS.map((key) => [key, config?.[key] ?? DEFAULT_EDITOR_TRACKING_CONFIG[key]]),
      ) as Record<FieldKey, string>,
    [config],
  );
  const names = drafts ?? storedNames;

  // The same rule `resolveEditorTrackingConfig` enforces, surfaced before the
  // configuration is stored rather than as a throw at stamping time.
  const invalid = useMemo(() => nameProblem(names), [names]);

  // What to persist when the drafts are unusable: the stored names, or the
  // defaults when a hand-edited project left those broken too. Writing an
  // invalid set would be a dead end — the inputs are only rendered while
  // tracking is on, so a bad set stored on the way out leaves no way back in.
  const safeNames = invalid ? (nameProblem(storedNames) ? DEFAULT_NAMES : storedNames) : names;

  const write = (patch: Partial<EditorTrackingConfig>) => {
    const next: EditorTrackingConfig = {
      enabled,
      ...(Object.fromEntries(FIELD_KEYS.map((key) => [key, safeNames[key].trim()])) as Record<
        FieldKey,
        string
      >),
      ...patch,
    };
    // Leave the defaults implicit: a layer that renames nothing stores just
    // `{ enabled: true }`, which keeps the project file and its diffs clean.
    for (const key of FIELD_KEYS) {
      if (next[key] === DEFAULT_EDITOR_TRACKING_CONFIG[key]) delete next[key];
    }
    // Turning tracking off keeps renamed columns configured, so switching it
    // back on resumes writing the same columns instead of starting a second
    // set beside the data already stamped. With nothing customized there is
    // nothing worth persisting, so the layer drops the key entirely.
    const customized = FIELD_KEYS.some((key) => next[key] !== undefined);
    setLayerEditorTracking(layer.id, next.enabled || customized ? next : undefined);
  };

  const toggleEnabled = (checked: boolean) => {
    // Discard unusable drafts rather than carrying them across the toggle, so
    // the inputs agree with what `write` just stored.
    if (invalid) setDrafts(null);
    write({ enabled: checked });
  };

  const commitNames = () => {
    if (invalid) return;
    setDrafts(null);
    if (enabled) write({});
  };

  return (
    <div className="space-y-3" data-testid="editor-tracking-section">
      <p className="text-sm font-semibold">{t("style.editorTracking.heading")}</p>
      <p className="text-xs text-muted-foreground">{t("style.editorTracking.description")}</p>
      <label className="flex items-center gap-2 text-xs">
        {/* Never disabled: `write` falls back to a usable name set, so the
            checkbox stays the way out of any half-typed configuration. */}
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggleEnabled(event.target.checked)}
        />
        <span>{t("style.editorTracking.enable")}</span>
      </label>

      {enabled && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`et-identity-${layer.id}`}>{t("style.editorTracking.identity")}</Label>
            <Input
              id={`et-identity-${layer.id}`}
              value={sessionIdentity ?? authorName}
              disabled={sessionIdentity !== null}
              placeholder={DEFAULT_EDITOR_IDENTITY}
              onChange={(event) => setAuthorName(event.target.value)}
              onBlur={() => setStoredAuthorName(authorName)}
            />
            <p className="text-xs text-muted-foreground">
              {sessionIdentity
                ? t("style.editorTracking.identityFromSession")
                : t("style.editorTracking.identityHint", {
                    name: authorName.trim() || DEFAULT_EDITOR_IDENTITY,
                  })}
            </p>
          </div>

          {FIELD_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`et-${key}-${layer.id}`}>{t(`style.editorTracking.${key}`)}</Label>
              <Input
                id={`et-${key}-${layer.id}`}
                className="font-mono text-xs"
                value={names[key]}
                onChange={(event) => setDrafts({ ...names, [key]: event.target.value })}
                onBlur={commitNames}
              />
            </div>
          ))}
          {invalid && (
            <p className="text-xs text-destructive">{t(`style.editorTracking.${invalid}`)}</p>
          )}
        </>
      )}
    </div>
  );
}

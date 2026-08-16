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
  const names = useMemo(() => {
    if (drafts) return drafts;
    return Object.fromEntries(
      FIELD_KEYS.map((key) => [key, config?.[key] ?? DEFAULT_EDITOR_TRACKING_CONFIG[key]]),
    ) as Record<FieldKey, string>;
  }, [drafts, config]);

  // The same rule `resolveEditorTrackingConfig` enforces, surfaced before the
  // configuration is stored rather than as a throw at stamping time.
  const invalid = useMemo(() => {
    const values = FIELD_KEYS.map((key) => names[key].trim());
    if (values.some((value) => value === "")) return "blankName" as const;
    if (new Set(values).size !== values.length) return "duplicateName" as const;
    return null;
  }, [names]);

  const write = (patch: Partial<EditorTrackingConfig>) => {
    const next: EditorTrackingConfig = {
      enabled,
      ...(Object.fromEntries(FIELD_KEYS.map((key) => [key, names[key].trim()])) as Record<
        FieldKey,
        string
      >),
      ...patch,
    };
    // Leave the defaults implicit: a layer that renames nothing stores just
    // `{ enabled: true }`, which keeps the project file and its diffs clean.
    // A blank name is dropped the same way — the checkbox refuses to turn
    // tracking ON while one is blank, but turning it OFF stays available, and
    // that must not persist a name nothing can use.
    for (const key of FIELD_KEYS) {
      if (!next[key] || next[key] === DEFAULT_EDITOR_TRACKING_CONFIG[key]) delete next[key];
    }
    // Turning tracking off keeps renamed columns configured, so switching it
    // back on resumes writing the same columns instead of starting a second
    // set beside the data already stamped. With nothing customized there is
    // nothing worth persisting, so the layer drops the key entirely.
    const customized = FIELD_KEYS.some((key) => next[key] !== undefined);
    setLayerEditorTracking(layer.id, next.enabled || customized ? next : undefined);
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
        <input
          type="checkbox"
          checked={enabled}
          disabled={!enabled && invalid !== null}
          onChange={(event) => write({ enabled: event.target.checked })}
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

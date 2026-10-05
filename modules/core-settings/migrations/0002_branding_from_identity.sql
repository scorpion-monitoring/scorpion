-- `instanceName` and `mailFrom` moved from the settings of core.identity to the `branding` settings
-- of core.settings (ADR-0018). A database that stored them under core.identity keeps them: they are
-- copied into `branding` (a value already in `branding` wins) and removed from the identity row,
-- whose schema no longer knows them. Only rows of this module's own table are touched.
WITH moved AS (
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'instanceName', value -> 'instanceName',
           'mailFrom', value -> 'mailFrom')) AS fields
    FROM settings_setting
   WHERE module_id = 'core.identity'
     AND (value ? 'instanceName' OR value ? 'mailFrom')
)
INSERT INTO settings_setting (module_id, value, version)
SELECT 'core.settings', jsonb_build_object('branding', fields), 1 FROM moved
ON CONFLICT (module_id) DO UPDATE
   SET value = jsonb_set(
         settings_setting.value,
         '{branding}',
         (EXCLUDED.value -> 'branding') || coalesce(settings_setting.value -> 'branding', '{}'::jsonb)),
       version = settings_setting.version + 1,
       updated_at = now();
--> statement-breakpoint
UPDATE settings_setting
   SET value = value - 'instanceName' - 'mailFrom',
       version = version + 1,
       updated_at = now()
 WHERE module_id = 'core.identity'
   AND (value ? 'instanceName' OR value ? 'mailFrom');

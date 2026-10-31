import { useQueryClient } from "@tanstack/react-query";
import {
  BB_SKILL_SOURCE_IDS,
  defaultAppSettings,
  type BbSkillSourceId,
} from "@bb/domain";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import { invalidateAllProjectSkillsQueries } from "@/hooks/cache-owners/skills-cache-effects";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { useSystemConfig } from "@/hooks/queries/system-queries";

const SKILL_SOURCE_COPY: Readonly<
  Record<BbSkillSourceId, { label: string; description: string }>
> = {
  "bb-plugins": {
    label: "Plugin skills",
    description:
      "Skills that installed bb plugins bring, including their command skills.",
  },
  "bb-user": {
    label: "Your bb skills",
    description: "Skills in bb's own skills folder in its data directory.",
  },
  "bb-project": {
    label: "Project skills",
    description: "Skills in each project's .bb/skills folder.",
  },
  shared: {
    label: "Shared skill folders",
    description: "Folders listed under sharedSkillRoots in config.json.",
  },
};

export function SkillSourcesSettings() {
  const queryClient = useQueryClient();
  const systemConfigQuery = useSystemConfig();
  const updateGeneralSettings = useUpdateGeneralSettings();
  const disabledSources =
    systemConfigQuery.data?.generalSettings.disabledSkillSources ??
    defaultAppSettings.disabledSkillSources;
  const setSourceEnabled = (source: BbSkillSourceId, enabled: boolean) => {
    updateGeneralSettings.mutate(
      {
        disabledSkillSources: BB_SKILL_SOURCE_IDS.filter((id) =>
          id === source ? !enabled : disabledSources.includes(id),
        ),
      },
      {
        onSuccess: () => invalidateAllProjectSkillsQueries({ queryClient }),
      },
    );
  };
  return (
    <SettingsSection title="Skill sources">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Where bb itself loads skills from to give to every agent. Skills that
          an agent loads on its own, such as pi packages or ~/.agents/skills,
          are not affected.
        </p>
        {BB_SKILL_SOURCE_IDS.map((source) => (
          <SettingsWithControl
            key={source}
            label={SKILL_SOURCE_COPY[source].label}
            description={SKILL_SOURCE_COPY[source].description}
          >
            <Switch
              checked={!disabledSources.includes(source)}
              disabled={systemConfigQuery.data === undefined}
              onCheckedChange={(enabled) => setSourceEnabled(source, enabled)}
              aria-label={SKILL_SOURCE_COPY[source].label}
            />
          </SettingsWithControl>
        ))}
      </div>
    </SettingsSection>
  );
}

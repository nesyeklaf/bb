import { BB_SKILL_SOURCE_IDS, type BbSkillSourceId } from "@bb/domain";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section.js";

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
    description:
      "Skills in bb's own skills folder in its data directory and in the folders set by BB_INHERITED_SKILLS_ROOTS.",
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

export function SkillSourcesSettings({
  disabled,
  disabledSources,
  onDisabledSourcesChange,
}: {
  disabled: boolean;
  disabledSources: readonly BbSkillSourceId[];
  onDisabledSourcesChange: (disabledSources: BbSkillSourceId[]) => void;
}) {
  const setSourceEnabled = (source: BbSkillSourceId, enabled: boolean) => {
    onDisabledSourcesChange(
      BB_SKILL_SOURCE_IDS.filter((id) =>
        id === source ? !enabled : disabledSources.includes(id),
      ),
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
              disabled={disabled}
              onCheckedChange={(enabled) => setSourceEnabled(source, enabled)}
              aria-label={SKILL_SOURCE_COPY[source].label}
            />
          </SettingsWithControl>
        ))}
      </div>
    </SettingsSection>
  );
}

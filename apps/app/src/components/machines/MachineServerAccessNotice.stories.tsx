import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { MachineServerAccessNoticeContent } from "./MachineServerAccessNotice";
import { machineServerAccessBlockedReason } from "./machine-server-access";
import {
  TAILNET_READY,
  TAILNET_SETUP_REQUIRED,
} from "../../../.ladle/machine-story-fixtures";

export default {
  title: "settings/Machine server access notice",
};

export function Reasons() {
  return (
    <StoryCard labelWidth="230px" className="max-w-4xl">
      <StoryRow
        label="access is not set up"
        hint="whatever the method's own complaint is, the reader is told the one thing to do"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(TAILNET_SETUP_REQUIRED)}
        />
      </StoryRow>
      <StoryRow
        label="access is set up"
        hint="the notice renders nothing at all"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(TAILNET_READY)}
        />
      </StoryRow>
    </StoryCard>
  );
}

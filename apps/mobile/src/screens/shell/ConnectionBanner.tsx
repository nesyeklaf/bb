import { View, type ViewStyle } from "react-native";
import Animated, {
  FadeInUp,
  FadeOutUp,
  LinearTransition,
} from "react-native-reanimated";
import { useConnectionBanner, useProfiles } from "@/app-shell";
import type { ConnectionBannerKind } from "@/lib/connection";
import { useTheme } from "@/theme";
import { Icon, Text, type IconName } from "@/ui";

interface BannerCopy {
  icon: IconName;
  message: (label: string) => string;
}

const COPY: Record<Exclude<ConnectionBannerKind, "hidden">, BannerCopy> = {
  connecting: {
    icon: "Loading",
    message: (label) => `Connecting to ${label}…`,
  },
  reconnecting: {
    icon: "ArrowReloadHorizontal",
    message: (label) => `Connection to ${label} lost. Reconnecting…`,
  },
};

const ENTER_MS = 220;
const EXIT_MS = 160;

const CARD_RADIUS = 12;

export function ConnectionBanner() {
  const kind = useConnectionBanner();
  const { activeProfile } = useProfiles();
  const { tokens } = useTheme();

  if (kind === "hidden" || !activeProfile) return null;
  const copy = COPY[kind];
  const color = tokens.warningText;
  const message = copy.message(activeProfile.label);
  const cardStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: CARD_RADIUS,
    borderCurve: "continuous",
    backgroundColor: tokens.surfaceAttention,
  };
  return (
    <Animated.View
      entering={FadeInUp.duration(ENTER_MS)}
      exiting={FadeOutUp.duration(EXIT_MS)}
      layout={LinearTransition.duration(ENTER_MS)}
    >
      <View
        testID="connection-banner"
        accessibilityLiveRegion="polite"
        style={cardStyle}
      >
        <Icon name={copy.icon} size={18} weight="semibold" color={color} />
        <Text
          variant="footnote"
          weight="medium"
          numberOfLines={2}
          className="flex-1"
          style={{ color }}
          testID={`connection-banner-${kind}`}
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

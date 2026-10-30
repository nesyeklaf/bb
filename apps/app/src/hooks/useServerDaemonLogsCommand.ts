import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useDesktopInfo } from "@/hooks/useDesktopInfo";

export function useServerDaemonLogsCommand(): void {
  const { desktopApi, desktopInfo } = useDesktopInfo();
  const openLogs = desktopApi?.openServerDaemonLogs;
  const enabled =
    openLogs !== undefined && desktopInfo?.serverDaemonLogsAvailable === true;

  useAppCommandHandler(
    "logs.openServerDaemon",
    () => {
      if (openLogs === undefined) {
        return false;
      }
      void openLogs.call(desktopApi).catch(() => undefined);
      return true;
    },
    0,
    enabled,
  );
}

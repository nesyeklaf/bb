import {
  deleteAllPluginKvValues,
  deleteAllPluginSettings,
  deletePluginKvValue,
  getAiServiceSelections,
  hasAppSettingsMarker,
  listPluginKvKeys,
  setAiServiceSelection,
  setAppSettingsMarker,
  type DbConnection,
} from "@bb/db";
import { AI_TASKS } from "@bb/domain";

const MARKER_KEY = "retiredState.outgoingConnections.v1";
const RETIRED_AI_PLUGIN_IDS: ReadonlySet<string> = new Set(["bb-ai"]);
const RETIRED_PLUGIN_IDS = ["bb-ai", "environment-modal-sandbox"] as const;
const ACCOUNT_PLUGIN_ID = "bb-account";
const PUSH_PLUGIN_ID = "push-notifications";
const PUSH_SUBSCRIPTION_KEY_PREFIX = "subscription:";

export interface RetiredOutgoingStateReport {
  aiSelectionsReset: number;
  pushSubscriptionsRemoved: number;
  accountKvRemoved: number;
  retiredPluginRowsCleared: number;
}

export function removeRetiredOutgoingConnectionState(
  db: DbConnection,
): RetiredOutgoingStateReport | null {
  if (hasAppSettingsMarker(db, MARKER_KEY)) return null;
  const report: RetiredOutgoingStateReport = {
    aiSelectionsReset: 0,
    pushSubscriptionsRemoved: 0,
    accountKvRemoved: 0,
    retiredPluginRowsCleared: 0,
  };
  const selections = getAiServiceSelections(db);
  for (const task of AI_TASKS) {
    const selection = selections[task];
    if (
      selection.mode === "service" &&
      RETIRED_AI_PLUGIN_IDS.has(selection.pluginId)
    ) {
      setAiServiceSelection(db, task, { mode: "automatic" });
      report.aiSelectionsReset++;
    }
  }
  for (const key of listPluginKvKeys(
    db,
    PUSH_PLUGIN_ID,
    PUSH_SUBSCRIPTION_KEY_PREFIX,
  )) {
    if (deletePluginKvValue(db, PUSH_PLUGIN_ID, key)) {
      report.pushSubscriptionsRemoved++;
    }
  }
  report.accountKvRemoved = deleteAllPluginKvValues(db, ACCOUNT_PLUGIN_ID);
  for (const pluginId of RETIRED_PLUGIN_IDS) {
    report.retiredPluginRowsCleared += deleteAllPluginKvValues(db, pluginId);
    deleteAllPluginSettings(db, pluginId);
  }
  setAppSettingsMarker(db, MARKER_KEY);
  return report;
}

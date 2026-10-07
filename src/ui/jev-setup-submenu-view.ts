import { truncateToWidth } from "@earendil-works/pi-tui";

import {
  canClearCredential,
  providerName,
  transportLabel,
} from "./jev-setup-support.ts";
import type {
  JevSetupSubmenuOptions,
  JevSetupViewState,
  SetupAction,
} from "./jev-setup-support.ts";
import type { MaskedInput } from "./masked-input.ts";

export const setupActions = (state: JevSetupViewState): SetupAction[] => {
  const actions: SetupAction[] = ["typesafe", "openrouter", "openai-decisions"];
  if (state.canEnterKey) {
    actions.push("enter-key");
  }
  if (state.filterEnabled) {
    actions.push("disable");
  }
  if (state.credentials && canClearCredential(state.credentials)) {
    actions.push("clear-stored-key");
  }
  actions.push("done");
  return actions;
};

const setupLabels = (state: JevSetupViewState): string[] =>
  setupActions(state).map((action) => {
    if (action === "clear-stored-key") {
      return state.filterEnabled
        ? "Disable and clear stored key"
        : "Clear stored key";
    }
    if (action === "disable") {
      return "Disable";
    }
    if (action === "done") {
      return "Done";
    }
    if (action === "enter-key") {
      return state.selectedTransport === "openai-decisions"
        ? "Enter an OpenAI Platform API key"
        : "Enter a TypeSafe API key";
    }
    return providerName(action);
  });

export const renderJevSetup = (
  options: JevSetupSubmenuOptions,
  state: JevSetupViewState,
  maskedInput: MaskedInput,
  width: number
): string[] => {
  const { theme } = options;
  const lines = [
    theme.fg("accent", theme.bold("  Jev/Decisions consultation filter")),
    "",
    `  Filter: ${state.filterEnabled ? "On" : "Off"}`,
  ];
  if (state.credentials) {
    lines.push(`  Credential: ${transportLabel(state.credentials)}`);
  } else if (state.selectedTransport) {
    lines.push(`  Selected provider: ${providerName(state.selectedTransport)}`);
  } else {
    lines.push(`  Saved transport: ${options.currentTransport}`);
  }
  if (state.notice) {
    lines.push("", theme.fg("warning", `  ${state.notice}`));
  }
  lines.push("");
  if (state.mode === "resolving") {
    lines.push("  Checking the selected provider credentials…");
  } else if (state.mode === "verifying") {
    lines.push("  Verifying with a live Jev call…");
  } else if (state.mode === "clearing") {
    lines.push("  Clearing the selected provider's stored key…");
  } else if (state.mode === "key-entry") {
    lines.push(
      `  ${providerName(state.selectedTransport ?? "typesafe")}`,
      state.selectedTransport === "openai-decisions"
        ? "  No OpenAI Platform API key found. ChatGPT subscription OAuth is not accepted."
        : "  No TypeSafe API key found.",
      `  ${maskedInput.render(Math.max(10, width - 4))[0] ?? ""}`,
      theme.fg("dim", "  Enter: verify and securely store · Esc: return")
    );
  } else {
    for (const [index, label] of setupLabels(state).entries()) {
      const prefix = index === state.selectedIndex ? "→ " : "  ";
      lines.push(`${prefix}${label}`);
    }
  }
  return lines.map((line) => truncateToWidth(line, width));
};

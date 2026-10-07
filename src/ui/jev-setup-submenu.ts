import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import type { JevCredentials, JevTransportKind } from "../jev/transport.ts";
import { redactSecrets } from "../redaction.ts";
import { renderJevSetup, setupActions } from "./jev-setup-submenu-view.ts";
import {
  canClearCredential,
  canReplaceWithEnteredKey,
  consumeSetupPlaintextWarning,
  defaultSetupDeps,
  fireAndForget,
} from "./jev-setup-support.ts";
import type {
  JevSetupSubmenuOptions,
  JevSetupViewState,
  SetupAction,
  SetupMode,
} from "./jev-setup-support.ts";
import { MaskedInput } from "./masked-input.ts";
import type { JevSetupDeps, JevSetupSelection } from "./types.ts";

export class JevSetupSubmenu implements Component, Focusable {
  private readonly options: JevSetupSubmenuOptions;
  private readonly deps: Required<JevSetupDeps>;
  private maskedInput: MaskedInput;
  private credentials: JevCredentials | undefined;
  private selectedTransport: JevTransportKind | undefined;
  private mode: SetupMode = "menu";
  private notice: string | undefined;
  private selectedIndex = 0;
  private filterEnabled: boolean;
  private canEnterKey = false;
  private pendingSelectionRefresh = false;
  private _focused = true;

  constructor(options: JevSetupSubmenuOptions, deps: JevSetupDeps = {}) {
    this.options = options;
    this.filterEnabled = options.currentValue === "On";
    this.deps = { ...defaultSetupDeps, ...options.setupDeps, ...deps };
    this.maskedInput = this.createMaskedInput("Paste a TypeSafe API key");
    void fireAndForget(this.refresh(), this.reportBackgroundError);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.maskedInput.focused = value;
  }

  invalidate(): void {
    this.maskedInput.invalidate();
  }

  handleInput(keyData: string): void {
    if (this.mode === "key-entry") {
      this.maskedInput.handleInput(keyData);
      this.options.tui.requestRender();
      return;
    }
    if (this.mode !== "menu") {
      return;
    }
    const actions = setupActions(this.viewState());
    if (
      matchesKey(keyData, Key.down) ||
      keyData === "\u001B[B" ||
      keyData === "\u001BOB"
    ) {
      this.selectedIndex = (this.selectedIndex + 1) % actions.length;
    } else if (
      matchesKey(keyData, Key.up) ||
      keyData === "\u001B[A" ||
      keyData === "\u001BOA"
    ) {
      this.selectedIndex =
        (this.selectedIndex - 1 + actions.length) % actions.length;
    } else if (matchesKey(keyData, Key.enter) || keyData === "\r") {
      this.activate(actions[this.selectedIndex]);
    } else {
      return;
    }
    this.options.tui.requestRender();
  }

  render(width: number): string[] {
    return renderJevSetup(
      this.options,
      this.viewState(),
      this.maskedInput,
      width
    );
  }

  private viewState(): JevSetupViewState {
    return {
      canEnterKey: this.canEnterKey,
      credentials: this.credentials,
      filterEnabled: this.filterEnabled,
      mode: this.mode,
      notice: this.notice,
      selectedIndex: this.selectedIndex,
      selectedTransport: this.selectedTransport,
    };
  }

  private createMaskedInput(placeholder: string): MaskedInput {
    return new MaskedInput({
      onEscape: () => this.cancelKeyEntry(),
      onSubmit: (value) => this.submitEnteredKey(value),
      placeholder,
    });
  }

  private async refresh(): Promise<void> {
    this.mode = "resolving";
    this.options.tui.requestRender();
    try {
      const credentials = await this.deps.resolveTransport(
        this.options.currentTransport === "auto"
          ? undefined
          : this.options.currentTransport
      );
      this.credentials = credentials;
      this.selectedTransport = credentials?.transport;
      this.mode = "menu";
      this.selectedIndex = 0;
      if (credentials?.source === "advisor-json") {
        this.notice = consumeSetupPlaintextWarning();
      }
      this.options.tui.requestRender();
    } catch (error) {
      this.reportBackgroundError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private activate(action: SetupAction): void {
    if (action === "done") {
      this.closeSetup();
      return;
    }
    if (action === "disable") {
      this.notice = undefined;
      if (
        this.commitSelection(
          {
            enabled: false,
            transport: this.options.currentTransport,
          },
          "Off"
        )
      ) {
        this.filterEnabled = false;
      }
      return;
    }
    if (action === "clear-stored-key") {
      void fireAndForget(this.disableAndClear(), this.reportBackgroundError);
      return;
    }
    if (action === "enter-key") {
      if (this.selectedTransport) {
        this.openKeyEntry(this.selectedTransport);
      }
      return;
    }
    void fireAndForget(this.selectProvider(action), this.reportBackgroundError);
  }

  private reportBackgroundError = (message: string): void => {
    this.mode = "menu";
    this.notice = `Setup failed: ${redactSecrets(message)}`;
    this.options.tui.requestRender();
  };

  private async selectProvider(transport: JevTransportKind): Promise<void> {
    this.selectedTransport = transport;
    this.mode = "resolving";
    this.notice = undefined;
    this.canEnterKey = false;
    this.options.tui.requestRender();
    let credentials: JevCredentials | undefined;
    try {
      credentials = await this.deps.resolveTransport(transport);
    } catch (error) {
      this.mode = "menu";
      this.notice = `Credential lookup failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`;
      this.options.tui.requestRender();
      return;
    }
    this.credentials = credentials;
    this.mode = "menu";
    if (!credentials) {
      if (transport === "typesafe" || transport === "openai-decisions") {
        this.notice = undefined;
        this.openKeyEntry(transport);
      } else {
        this.notice = "No OpenRouter Pi login found. Add one in Pi and retry.";
      }
      this.options.tui.requestRender();
      return;
    }
    if (credentials.transport !== transport) {
      this.notice =
        "The selected provider did not resolve matching credentials.";
      this.options.tui.requestRender();
      return;
    }
    await this.verifyAndEnable(credentials);
  }

  private openKeyEntry(transport: JevTransportKind): void {
    this.selectedTransport = transport;
    this.mode = "key-entry";
    const placeholder =
      transport === "openai-decisions"
        ? "Paste an OpenAI Platform API key"
        : "Paste a TypeSafe API key";
    this.maskedInput = this.createMaskedInput(placeholder);
    this.maskedInput.focused = this._focused;
    this.options.tui.requestRender();
  }

  private cancelKeyEntry(): void {
    this.mode = "menu";
    this.selectedTransport = undefined;
    this.maskedInput.setValue("");
    this.options.tui.requestRender();
  }

  private async submitEnteredKey(value: string): Promise<void> {
    const transport = this.selectedTransport;
    const key = value.trim();
    this.maskedInput.setValue("");
    if (!transport || !key) {
      return;
    }
    await this.verifyAndEnable({ apiKey: key, transport }, key);
  }

  private async verifyAndEnable(
    credentials: JevCredentials,
    enteredKey?: string
  ): Promise<void> {
    this.mode = "verifying";
    this.notice = undefined;
    this.options.tui.requestRender();
    const outcome = await this.deps.verify(credentials);
    if (!outcome.ok) {
      this.notice = `Verification failed: ${outcome.message ?? "unknown error"}`;
      this.mode = enteredKey ? "key-entry" : "menu";
      this.canEnterKey = !enteredKey && canReplaceWithEnteredKey(credentials);
      this.options.tui.requestRender();
      return;
    }
    const keyToStore =
      enteredKey ??
      (credentials.transport === "typesafe" &&
      credentials.source === "advisor-json"
        ? credentials.apiKey
        : undefined);
    if (keyToStore) {
      const stored = await this.deps.writeKey(
        keyToStore,
        credentials.transport
      );
      if (!stored.ok) {
        this.notice = stored.message;
        this.mode = "key-entry";
        this.canEnterKey = false;
        this.options.tui.requestRender();
        return;
      }
      if (
        credentials.transport === "typesafe" &&
        credentials.source === "advisor-json"
      ) {
        const removed = this.deps.removePlaintextKey();
        this.notice = removed.ok
          ? "Key moved from advisor.json into the secure store."
          : `Stored securely, but ${removed.message}`;
      } else {
        this.notice = `${stored.message} Verification succeeded.`;
      }
    }
    this.credentials = credentials;
    const saved = this.commitSelection(
      { enabled: true, transport: credentials.transport },
      "On"
    );
    if (!saved) {
      this.mode = "menu";
      this.notice ??= "Provider verified, but settings could not be saved.";
      this.options.tui.requestRender();
      return;
    }
    this.filterEnabled = true;
    this.mode = "menu";
    this.canEnterKey = false;
    this.options.tui.requestRender();
  }

  private commitSelection(
    selection: JevSetupSelection,
    legacyValue: string
  ): boolean {
    if (this.options.onSelection) {
      if (!this.options.onSelection(selection)) {
        return false;
      }
      this.closeSetup(true);
      return true;
    }
    this.options.done(legacyValue);
    return true;
  }

  private closeSetup(refreshSettings = false): void {
    this.options.done();
    if (refreshSettings || this.pendingSelectionRefresh) {
      this.options.afterSelection?.();
    }
    this.pendingSelectionRefresh = false;
  }

  private async disableAndClear(): Promise<void> {
    const { credentials } = this;
    if (!(credentials && canClearCredential(credentials))) {
      return;
    }
    if (this.options.onSelection) {
      const saved = this.options.onSelection({
        enabled: false,
        transport: this.options.currentTransport,
      });
      if (!saved) {
        this.mode = "menu";
        this.notice =
          "Could not save the disabled state; the key was not cleared.";
        this.options.tui.requestRender();
        return;
      }
      this.filterEnabled = false;
      this.pendingSelectionRefresh = true;
    }
    this.mode = "clearing";
    this.notice = undefined;
    this.options.tui.requestRender();
    const result = await this.deps.clearStoredKey(credentials.transport);
    this.mode = "menu";
    this.notice = result.message;
    if (!result.ok) {
      this.options.tui.requestRender();
      return;
    }
    this.credentials = undefined;
    if (this.options.onSelection) {
      this.closeSetup();
    } else if (
      this.commitSelection(
        { enabled: false, transport: this.options.currentTransport },
        "Off"
      )
    ) {
      this.filterEnabled = false;
    }
    this.options.tui.requestRender();
  }
}

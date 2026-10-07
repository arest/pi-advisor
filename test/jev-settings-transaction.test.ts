import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { registerCommands } from "../src/commands.ts";
import {
  advisorJevFilterEnabledRef,
  advisorJevTransportRef,
  getAdvisorSettings,
  setAdvisorJevFilterEnabledRef,
  setAdvisorJevTransportRef,
  setAdvisorOutcomeLoggingRef,
} from "../src/config/state.ts";
import { resetConfigCache } from "../src/config/storage.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

afterEach(() => {
  setAdvisorJevFilterEnabledRef(false);
  setAdvisorJevTransportRef("auto");
  setAdvisorOutcomeLoggingRef(false);
  resetConfigCache();
});

const setupCommands = async (dir: string) => {
  const commands = new Map<string, any>();
  let selector: any;
  const notices: string[] = [];
  registerCommands(mockPi({ commands }));
  const ctx = asExtensionContext({
    cwd: dir,
    hasUI: true,
    isProjectTrusted: () => false,
    ui: {
      custom: async (factory: any) => {
        selector = factory(
          { requestRender: () => {} },
          plainThemeMock,
          { matches: () => false },
          () => {}
        );
        return undefined;
      },
      notify: (message: string) => notices.push(message),
      setStatus: () => {},
    },
  });
  await commands.get("advisor-settings").handler("", ctx);
  return { notices, selector };
};

describe("Jev setup settings transaction", () => {
  test("persists provider and enabled state together while preserving consent and unknown fields", async () => {
    await withAgentDir(
      {
        advisorJevFilterEnabled: false,
        advisorJevTransport: "auto",
        advisorOutcomeLogging: true,
        futureSetting: "keep",
      },
      async (dir) => {
        const { notices, selector } = await setupCommands(dir);
        // SAFETY: applyJevSetup is the selector's typed transaction boundary exercised by the setup submenu.
        const saved = (selector as any).applyJevSetup({
          enabled: true,
          transport: "openai-decisions",
        });
        expect(saved).toBe(true);
        expect(savedConfig(dir)).toMatchObject({
          advisorJevFilterEnabled: true,
          advisorJevTransport: "openai-decisions",
          advisorOutcomeLogging: true,
          futureSetting: "keep",
        });
        expect(
          notices.some((notice) =>
            notice.startsWith("Could not save Advisor settings")
          )
        ).toBe(false);
        selector.dispose();
        setAdvisorJevFilterEnabledRef(false);
        setAdvisorJevTransportRef("auto");
      }
    );
  });

  test("rolls back runtime and selector-local values when the config write fails", async () => {
    await withAgentDir(
      {
        advisorJevFilterEnabled: false,
        advisorJevTransport: "auto",
      },
      async (dir) => {
        const { notices, selector } = await setupCommands(dir);
        rmSync(join(dir, "advisor.json"));
        mkdirSync(join(dir, "advisor.json"));

        // SAFETY: applyJevSetup is the selector's typed transaction boundary exercised by the setup submenu.
        const saved = (selector as any).applyJevSetup({
          enabled: true,
          transport: "openai-decisions",
        });
        expect(saved).toBe(false);
        expect(advisorJevFilterEnabledRef).toBe(false);
        expect(advisorJevTransportRef).toBe("auto");
        expect(getAdvisorSettings()).toMatchObject({
          jevFilterEnabled: false,
          jevTransport: "auto",
        });
        // SAFETY: the selector keeps its pre-transaction local state on save failure.
        expect((selector as any).settings).toMatchObject({
          jevFilterEnabled: false,
          jevTransport: "auto",
        });
        expect(notices.join("\n")).toContain("Could not save Advisor settings");
        selector.dispose();
      }
    );
  });
});

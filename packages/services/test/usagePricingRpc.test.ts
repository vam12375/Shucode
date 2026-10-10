import assert from "node:assert/strict";
import test from "node:test";
import { ChannelClient, ChannelServer, createQueuePair, Event, ProxyChannel } from "@shucode/rpc";
import {
  ServiceChannels,
  usagePricingImportResultSchema,
  usagePricingSettingsSchema,
  type AppSettings,
  type AppUsageSnapshot,
} from "@shucode/shared";
import { IUsageStatsService } from "../src/usage-stats/usageStats.js";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

test("CC Switch JSON import round-trips through the real serialized UsageStats ProxyChannel", async () => {
  let settings = usagePricingSettingsSchema.parse({});
  const service = createUsageStatsService({
    settingService: {
      async get() {
        return { usagePricing: structuredClone(settings) } as AppSettings;
      },
      async update(patch) {
        settings = structuredClone(patch.usagePricing!);
      },
    },
    apiClient: {
      async request() {
        throw new Error("No network during JSON import");
      },
    },
    shucodeAgentService: {
      async getAppUsageStats() {
        return {} as AppUsageSnapshot;
      },
    },
  });
  const [clientProtocol, serverProtocol] = createQueuePair();
  const client = new ChannelClient(clientProtocol);
  const initialized = Event.toPromise(client.onDidInitialize);
  const server = new ChannelServer(serverProtocol, "usage-test");
  server.registerChannel(IUsageStatsService.channelName, ProxyChannel.fromService(service));
  assert.equal(IUsageStatsService.channelName, ServiceChannels.UsageStats);
  try {
    await initialized;
    const remote = ProxyChannel.toService<IUsageStatsService>(
      client.getChannel(ServiceChannels.UsageStats),
    );
    const json = JSON.stringify({
      version: 1,
      models: [
        {
          modelId: "rpc-model",
          displayName: "RPC Model",
          inputCostPerMillion: "2",
          outputCostPerMillion: "4",
          cacheReadCostPerMillion: "0.2",
          cacheCreationCostPerMillion: "0",
        },
      ],
    });
    const result = usagePricingImportResultSchema.parse(await remote.importCcSwitchPrices(json));
    assert.equal(result.imported, 1);
    assert.equal(result.settings.entries[0]?.modelId, "rpc-model");
    assert.deepEqual(await remote.getPricing(), result.settings);
    assert.equal((await remote.importCcSwitchPrices(json)).skipped, 1);
    await assert.rejects(
      remote.importCcSwitchPrices('{"models":[{"modelId":"bad"}]}'),
      /Invalid CC Switch pricing field/,
    );
    assert.equal((await remote.getPricing()).entries.length, 1);
  } finally {
    client.dispose();
    server.dispose();
    await service.disposeAllAndWait();
  }
});

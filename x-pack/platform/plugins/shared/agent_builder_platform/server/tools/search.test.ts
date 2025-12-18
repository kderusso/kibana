/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { platformCoreTools } from '@kbn/onechat-common';
import { searchTool } from './search';
import { agentBuilderPlatformTelemetry } from '../otel/instrumentation';
import * as searchUtils from '@kbn/onechat-genai-utils/tools';

jest.mock('../otel/instrumentation', () => ({
  agentBuilderPlatformTelemetry: {
    recordToolExecutionDuration: jest.fn(),
  },
}));

jest.mock('@kbn/onechat-genai-utils/tools', () => ({
  runSearchTool: jest.fn(),
}));

describe('searchTool', () => {
  const mockEsClient = elasticsearchServiceMock.createScopedClusterClient();
  const mockLogger = loggingSystemMock.createLogger();
  const mockModel = {
    id: 'test-model',
    connector: { connectorId: 'test-connector' },
  } as any;

  const createHandlerContext = () => ({
    esClient: mockEsClient,
    logger: mockLogger,
    request: {} as any,
    spaceId: 'default',
    modelProvider: {
      getDefaultModel: jest.fn().mockResolvedValue(mockModel),
    } as any,
    toolProvider: {} as any,
    runner: {} as any,
    resultStore: {} as any,
    events: {} as any,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(performance, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('telemetry instrumentation', () => {
    it('records telemetry with success outcome when search succeeds', async () => {
      const mockResults = [{ type: 'other', data: { results: [] } }];
      (searchUtils.runSearchTool as jest.Mock).mockResolvedValue({ results: mockResults });
      jest.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1800);

      const tool = searchTool();
      await tool.handler(
        { query: 'find documents', index: '*' },
        createHandlerContext()
      );

      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledTimes(1);
      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledWith(
        800, // 1800 - 1000
        {
          toolId: platformCoreTools.search,
          toolName: 'Search',
          outcome: 'success',
        }
      );
    });

    it('records telemetry with failure outcome when search throws', async () => {
      const error = new Error('Search failed');
      (searchUtils.runSearchTool as jest.Mock).mockRejectedValue(error);
      jest.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1100);

      const tool = searchTool();

      await expect(
        tool.handler({ query: 'test query', index: '*' }, createHandlerContext())
      ).rejects.toThrow('Search failed');

      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledTimes(1);
      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledWith(
        100, // 1100 - 1000
        {
          toolId: platformCoreTools.search,
          toolName: 'Search',
          outcome: 'failure',
        }
      );
    });
  });
});


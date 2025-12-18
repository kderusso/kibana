/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { ToolResultType } from '@kbn/onechat-common/tools/tool_result';
import { platformCoreTools } from '@kbn/onechat-common';
import { executeEsqlTool } from './execute_esql';
import { agentBuilderPlatformTelemetry } from '../otel/instrumentation';
import * as esqlUtils from '@kbn/onechat-genai-utils/tools/utils/esql';

jest.mock('../otel/instrumentation', () => ({
  agentBuilderPlatformTelemetry: {
    recordToolExecutionDuration: jest.fn(),
  },
}));

jest.mock('@kbn/onechat-genai-utils/tools/utils/esql', () => ({
  executeEsql: jest.fn(),
}));

describe('executeEsqlTool', () => {
  const mockEsClient = elasticsearchServiceMock.createScopedClusterClient();

  const createHandlerContext = () => ({
    esClient: mockEsClient,
    logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    request: {} as any,
    spaceId: 'default',
    modelProvider: {} as any,
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
    it('records telemetry with success outcome when execution succeeds', async () => {
      const mockResult = {
        columns: [{ name: 'count', type: 'long' }],
        values: [[10]],
      };

      (esqlUtils.executeEsql as jest.Mock).mockResolvedValue(mockResult);
      jest.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1500);

      const tool = executeEsqlTool();
      await tool.handler({ query: 'FROM index | STATS count = COUNT(*)' }, createHandlerContext());

      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledTimes(1);
      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledWith(
        500, // 1500 - 1000
        {
          toolId: platformCoreTools.executeEsql,
          toolName: 'Execute ES|QL',
          outcome: 'success',
        }
      );
    });

    it('records telemetry with failure outcome when execution throws', async () => {
      const error = new Error('Query execution failed');
      (esqlUtils.executeEsql as jest.Mock).mockRejectedValue(error);
      jest.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1200);

      const tool = executeEsqlTool();

      await expect(
        tool.handler({ query: 'INVALID QUERY' }, createHandlerContext())
      ).rejects.toThrow('Query execution failed');

      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledTimes(1);
      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledWith(
        200, // 1200 - 1000
        {
          toolId: platformCoreTools.executeEsql,
          toolName: 'Execute ES|QL',
          outcome: 'failure',
        }
      );
    });

    it('records correct duration for long-running queries', async () => {
      const mockResult = {
        columns: [{ name: 'result', type: 'string' }],
        values: [['data']],
      };

      (esqlUtils.executeEsql as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResult), 100))
      );

      const tool = executeEsqlTool();
      const startTime = performance.now();
      await tool.handler({ query: 'FROM index | LIMIT 1000' }, createHandlerContext());
      const endTime = performance.now();

      expect(agentBuilderPlatformTelemetry.recordToolExecutionDuration).toHaveBeenCalledTimes(1);
      const recordedDuration = (
        agentBuilderPlatformTelemetry.recordToolExecutionDuration as jest.Mock
      ).mock.calls[0][0];
      const actualDuration = endTime - startTime;

      // Allow some tolerance for timing differences
      expect(recordedDuration).toBeGreaterThanOrEqual(actualDuration - 10);
      expect(recordedDuration).toBeLessThanOrEqual(actualDuration + 10);
      expect(
        agentBuilderPlatformTelemetry.recordToolExecutionDuration
      ).toHaveBeenCalledWith(
        recordedDuration,
        expect.objectContaining({
          toolId: platformCoreTools.executeEsql,
          toolName: 'Execute ES|QL',
          outcome: 'success',
        })
      );
    });
  });

  describe('tool functionality', () => {
    it('executes ES|QL query and returns results', async () => {
      const mockResult = {
        columns: [{ name: 'count', type: 'long' }],
        values: [[42]],
      };

      (esqlUtils.executeEsql as jest.Mock).mockResolvedValue(mockResult);

      const tool = executeEsqlTool();
      const result = await tool.handler(
        { query: 'FROM index | STATS count = COUNT(*)' },
        createHandlerContext()
      );

      expect(esqlUtils.executeEsql).toHaveBeenCalledWith({
        query: 'FROM index | STATS count = COUNT(*)',
        esClient: mockEsClient.asCurrentUser,
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        type: ToolResultType.query,
        data: {
          esql: 'FROM index | STATS count = COUNT(*)',
        },
      });
      expect(result.results[1]).toMatchObject({
        type: ToolResultType.tabularData,
        data: {
          source: 'esql',
          query: 'FROM index | STATS count = COUNT(*)',
          columns: mockResult.columns,
          values: mockResult.values,
        },
      });
    });
  });
});


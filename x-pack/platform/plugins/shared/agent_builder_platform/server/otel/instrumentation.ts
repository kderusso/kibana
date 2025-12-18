/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  type Attributes,
  type Histogram,
  metrics,
  ValueType,
} from '@opentelemetry/api';

interface BasicAttributes {
  outcome: 'success' | 'failure';
}

interface ToolExecutionAttributes extends BasicAttributes {
  toolId?: string;
  toolName?: string;
}

interface TokenTimingAttributes extends BasicAttributes {
  model?: string;
  provider?: string;
}

export type AgentBuilderPlatformTelemetryAttributes = BasicAttributes &
  Partial<ToolExecutionAttributes> &
  Partial<TokenTimingAttributes>;

class AgentBuilderPlatformTelemetry {
  private readonly meter = metrics.getMeter('kibana.agent_builder_platform');

  private readonly toolExecutionDuration: Histogram<Attributes>;
  private readonly timeToFirstToken: Histogram<Attributes>;
  private readonly timeToLastToken: Histogram<Attributes>;

  // Provides detailed buckets for tool execution times
  // Most tool executions should fall in the 100ms-5s range
  private readonly TOOL_EXECUTION_BUCKET_BOUNDARIES = [
    0, 50, 100, 200, 350, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000,
  ];

  // Provides detailed buckets for token timing
  // First token typically arrives quickly (50-500ms), last token depends on response length
  private readonly TOKEN_TIMING_BUCKET_BOUNDARIES = [
    0, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000,
  ];

  constructor() {
    this.toolExecutionDuration = this.meter.createHistogram(
      'agent_builder_platform.tool.execution.duration',
      {
        description: 'Duration of tool execution',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
        advice: {
          explicitBucketBoundaries: this.TOOL_EXECUTION_BUCKET_BOUNDARIES,
        },
      }
    );

    this.timeToFirstToken = this.meter.createHistogram(
      'agent_builder_platform.token.first.duration',
      {
        description: 'Time to first token in response generation',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
        advice: {
          explicitBucketBoundaries: this.TOKEN_TIMING_BUCKET_BOUNDARIES,
        },
      }
    );

    this.timeToLastToken = this.meter.createHistogram(
      'agent_builder_platform.token.last.duration',
      {
        description: 'Time to last token in response generation',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
        advice: {
          explicitBucketBoundaries: this.TOKEN_TIMING_BUCKET_BOUNDARIES,
        },
      }
    );
  }

  private transformAttributes<T extends AgentBuilderPlatformTelemetryAttributes>(
    attributes: T
  ): Attributes {
    const { toolId, toolName, model, provider, outcome, ...rest } = attributes;

    const transformed: Attributes = {
      ...(toolId ? { 'tool.id': toolId } : {}),
      ...(toolName ? { 'tool.name': toolName } : {}),
      ...(model ? { 'model': model } : {}),
      ...(provider ? { 'provider': provider } : {}),
      ...(outcome ? { 'outcome': outcome } : {}),
      ...rest,
    };

    return transformed;
  }

  recordToolExecutionDuration = (
    duration: number,
    attributes: ToolExecutionAttributes
  ) => {
    const transformedAttributes =
      this.transformAttributes<ToolExecutionAttributes>(attributes);
    this.toolExecutionDuration.record(duration, transformedAttributes);
  };

  recordTimeToFirstToken = (duration: number, attributes: TokenTimingAttributes) => {
    const transformedAttributes =
      this.transformAttributes<TokenTimingAttributes>(attributes);
    this.timeToFirstToken.record(duration, transformedAttributes);
  };

  recordTimeToLastToken = (duration: number, attributes: TokenTimingAttributes) => {
    const transformedAttributes =
      this.transformAttributes<TokenTimingAttributes>(attributes);
    this.timeToLastToken.record(duration, transformedAttributes);
  };
}

export const agentBuilderPlatformTelemetry = new AgentBuilderPlatformTelemetry();


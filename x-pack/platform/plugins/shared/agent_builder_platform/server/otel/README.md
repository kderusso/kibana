# Agent Builder Platform Telemetry

This directory contains OpenTelemetry instrumentation for the Agent Builder Platform plugin.

## Overview

The telemetry system records:
- **Tool execution time**: Duration of tool handler execution
- **Time to first token**: Time from request start to first token in streaming responses
- **Time to last token**: Time from request start to last token in streaming responses

## Usage

### Instrumenting Tool Execution

Call the telemetry methods directly in your tool handler, following the same pattern as the security plugin:

```typescript
import { agentBuilderPlatformTelemetry } from '../otel/instrumentation';
import { platformCoreTools } from '@kbn/onechat-common';

export const myTool = (): BuiltinToolDefinition<typeof mySchema> => {
  return {
    id: platformCoreTools.myTool,
    type: ToolType.builtin,
    schema: mySchema,
    handler: async (params, context) => {
      const startTime = performance.now();
      let outcome: 'success' | 'failure' = 'success';

      try {
        // Your tool implementation
        return { results: [...] };
      } catch (error) {
        outcome = 'failure';
        throw error;
      } finally {
        const duration = performance.now() - startTime;
        agentBuilderPlatformTelemetry.recordToolExecutionDuration(duration, {
          toolId: platformCoreTools.myTool,
          toolName: 'My Tool Name',
          outcome,
        });
      }
    },
  };
};
```

The telemetry records:
- Execution duration
- Tool ID and name
- Success/failure outcome

### Instrumenting Token Timing

For tools that use streaming model responses, track token timing:

```typescript
import { agentBuilderPlatformTelemetry } from '../otel/instrumentation';

// In your tool handler when processing a stream:
const requestStartTime = performance.now();
let firstTokenTime: number | null = null;
let lastTokenTime: number | null = null;

// When first token arrives:
if (firstTokenTime === null) {
  firstTokenTime = performance.now();
  const duration = firstTokenTime - requestStartTime;
  agentBuilderPlatformTelemetry.recordTimeToFirstToken(duration, {
    model: model.id,
    provider: model.provider,
    outcome: 'success',
  });
}

// When stream completes:
lastTokenTime = performance.now();
const duration = lastTokenTime - requestStartTime;
agentBuilderPlatformTelemetry.recordTimeToLastToken(duration, {
  model: model.id,
  provider: model.provider,
  outcome: 'success', // or 'failure'
});
```

## Metrics

All metrics are exported with the meter name `kibana.agent_builder_platform`:

- `agent_builder_platform.tool.execution.duration` (histogram, ms)
- `agent_builder_platform.token.first.duration` (histogram, ms)
- `agent_builder_platform.token.last.duration` (histogram, ms)

## Examples

See the following files for examples:
- `../tools/execute_esql.ts` - Tool execution instrumentation
- `../tools/search.ts` - Tool execution instrumentation


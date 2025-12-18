# Agent Builder Platform Telemetry

This directory contains OpenTelemetry instrumentation for the Agent Builder Platform plugin.

## Overview

The telemetry system records:
- **Tool execution time**: Duration of tool handler execution
- **Time to first token**: Time from request start to first token in streaming responses
- **Time to last token**: Time from request start to last token in streaming responses

## Usage

### Instrumenting Tool Execution

Wrap your tool handler with `withToolTelemetry` to automatically record execution time:

```typescript
import { withToolTelemetry } from '../otel/utils';
import { platformCoreTools } from '@kbn/onechat-common';

export const myTool = (): BuiltinToolDefinition<typeof mySchema> => {
  return {
    id: platformCoreTools.myTool,
    type: ToolType.builtin,
    schema: mySchema,
    handler: withToolTelemetry(
      platformCoreTools.myTool,
      'My Tool Name',
      async (params, context) => {
        // Your tool implementation
        return { results: [...] };
      }
    ),
  };
};
```

The telemetry will automatically record:
- Execution duration
- Tool ID and name
- Success/failure outcome

### Instrumenting Token Timing

For tools that use streaming model responses, use `createTokenTimingTracker`:

```typescript
import { createTokenTimingTracker } from '../otel/utils';

// In your tool handler:
const model = await modelProvider.getDefaultModel();
const tokenTracker = createTokenTimingTracker({
  model: model.id,
  provider: model.provider,
});

// When processing a stream:
for await (const chunk of stream) {
  if (!tokenTracker.firstTokenTime) {
    tokenTracker.recordFirstToken();
  }
  // Process chunk...
}

// When stream completes:
tokenTracker.recordLastToken('success'); // or 'failure'
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


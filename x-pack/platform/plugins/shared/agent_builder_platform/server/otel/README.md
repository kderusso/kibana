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

For tools that use streaming model responses, use the `createTokenTimingTracker` helper:

```typescript
import { createTokenTimingTracker } from '../otel/token_timing';

// In your tool handler:
const model = await modelProvider.getDefaultModel();
const tokenTracker = createTokenTimingTracker(model);

// When processing a stream (e.g., using model.chatModel.stream):
try {
  const stream = model.chatModel.stream(prompt);
  
  for await (const chunk of stream) {
    // Record first token when first chunk arrives
    if (!tokenTracker.firstTokenTime && chunk?.content) {
      tokenTracker.recordFirstToken();
    }
    
    // Update last token time on each chunk
    if (chunk?.content) {
      tokenTracker.updateLastToken();
    }
    
    // Process chunk...
  }
  
  // Record last token when stream completes successfully
  tokenTracker.recordLastToken('success');
} catch (error) {
  // Record last token on error
  tokenTracker.recordLastToken('failure');
  throw error;
}
```

**Note:** Most tools use utility functions like `generateEsql()` and `runSearchTool()` which handle streaming internally. Token timing for these tools would need to be added at the utility function level. The tracker is available for tools that directly use `model.chatModel.stream()` or similar streaming APIs.

## Metrics

All metrics are exported with the meter name `kibana.agent_builder_platform`:

- `agent_builder_platform.tool.execution.duration` (histogram, ms)
- `agent_builder_platform.token.first.duration` (histogram, ms)
- `agent_builder_platform.token.last.duration` (histogram, ms)

## Examples

See the following files for examples:
- `../tools/execute_esql.ts` - Tool execution instrumentation
- `../tools/search.ts` - Tool execution instrumentation


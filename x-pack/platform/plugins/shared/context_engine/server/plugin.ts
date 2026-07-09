/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, CoreStart, Plugin, PluginInitializerContext } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type {
  ContextEnginePluginSetup,
  ContextEnginePluginStart,
  ContextEngineSetupDependencies,
  ContextEngineStartDependencies,
} from './types';
import { registerFeatures } from './features';
import { registerNamespaceRoutes } from './routes/namespaces';
import { NamespaceService } from './namespaces/service';

export class ContextEnginePlugin
  implements
    Plugin<
      ContextEnginePluginSetup,
      ContextEnginePluginStart,
      ContextEngineSetupDependencies,
      ContextEngineStartDependencies
    >
{
  private logger: Logger;
  private namespaceService?: NamespaceService;

  constructor(context: PluginInitializerContext) {
    this.logger = context.logger.get();
  }

  setup(
    coreSetup: CoreSetup<ContextEngineStartDependencies, ContextEnginePluginStart>,
    setupDeps: ContextEngineSetupDependencies
  ): ContextEnginePluginSetup {
    registerFeatures({ features: setupDeps.features });

    const router = coreSetup.http.createRouter();
    registerNamespaceRoutes({
      router,
      getNamespaceService: () => {
        if (!this.namespaceService) {
          throw new Error('Namespace service not available — plugin has not started');
        }
        return this.namespaceService;
      },
    });

    return {};
  }

  start(coreStart: CoreStart): ContextEnginePluginStart {
    this.namespaceService = new NamespaceService({
      esClient: coreStart.elasticsearch.client.asInternalUser,
      logger: this.logger.get('namespaces'),
    });

    return {};
  }

  stop() {}
}

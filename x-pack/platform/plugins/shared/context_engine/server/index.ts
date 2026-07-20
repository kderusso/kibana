/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { PluginInitializer, PluginInitializerContext } from '@kbn/core/server';
import type {
  ContextEnginePluginSetup,
  ContextEnginePluginStart,
  ContextEngineSetupDependencies,
  ContextEngineStartDependencies,
} from './types';

export type { ContextEnginePluginSetup, ContextEnginePluginStart } from './types';
export { AI_INDEX_IDX_PREFIX, AI_INDEX_DS_PREFIX } from './ai_indices/constants';

export const plugin: PluginInitializer<
  ContextEnginePluginSetup,
  ContextEnginePluginStart,
  ContextEngineSetupDependencies,
  ContextEngineStartDependencies
> = async (pluginInitializerContext: PluginInitializerContext) => {
  const { ContextEnginePlugin } = await import('./plugin');
  return new ContextEnginePlugin(pluginInitializerContext);
};

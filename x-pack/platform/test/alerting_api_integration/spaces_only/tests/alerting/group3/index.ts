/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FtrProviderContext } from '../../../../common/ftr_provider_context';
import { buildUp, tearDown } from '../../helpers';

export default function alertingTests({ loadTestFile, getService }: FtrProviderContext) {
  describe('Alerting', function () {
    this.tags('skipFIPS');
    before(async () => await buildUp(getService));
    after(async () => await tearDown(getService));

    loadTestFile(require.resolve('./builtin_alert_types'));
    loadTestFile(require.resolve('./maintenance_window_flows'));
    loadTestFile(require.resolve('./maintenance_window_scoped_query'));
    loadTestFile(require.resolve('./dangerously_create_alerts_in_all_spaces'));
  });
}

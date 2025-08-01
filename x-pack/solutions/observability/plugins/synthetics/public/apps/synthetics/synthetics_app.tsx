/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect } from 'react';

import { APP_WRAPPER_CLASS } from '@kbn/core/public';
import { i18n } from '@kbn/i18n';
import { InspectorContextProvider } from '@kbn/observability-shared-plugin/public';
import { KibanaRenderContextProvider } from '@kbn/react-kibana-context-render';
import { KibanaErrorBoundaryProvider } from '@kbn/shared-ux-error-boundary';
import { KibanaThemeProvider } from '@kbn/react-kibana-context-theme';
import { Router } from '@kbn/shared-ux-router';

import { PerformanceContextProvider } from '@kbn/ebt-tools';
import { SyntheticsSharedContext } from './contexts/synthetics_shared_context';
import { kibanaService } from '../../utils/kibana_service';
import { ActionMenu } from './components/common/header/action_menu';
import { TestNowModeFlyoutContainer } from './components/test_now_mode/test_now_mode_flyout_container';
import { SyntheticsAppProps, SyntheticsSettingsContextProvider } from './contexts';
import { PageRouter } from './routes';
import { setBasePath, store } from './state';

const Application = (props: SyntheticsAppProps) => {
  const { basePath, canSave, coreStart, renderGlobalHelpControls, setBadge, appMountParameters } =
    props;

  useEffect(() => {
    renderGlobalHelpControls();
    setBadge(
      !canSave
        ? {
            text: i18n.translate('xpack.synthetics.badge.readOnly.text', {
              defaultMessage: 'Read only',
            }),
            tooltip: i18n.translate('xpack.synthetics.badge.readOnly.tooltip', {
              defaultMessage: 'Unable to save',
            }),
            iconType: 'glasses',
          }
        : undefined
    );
  }, [canSave, renderGlobalHelpControls, setBadge]);

  kibanaService.theme = props.appMountParameters.theme$;

  store.dispatch(setBasePath(basePath));

  return (
    <KibanaRenderContextProvider {...coreStart}>
      <KibanaThemeProvider
        theme={coreStart.theme}
        modify={{
          breakpoint: {
            xxl: 1600,
            xxxl: 2000,
          },
        }}
      >
        <KibanaErrorBoundaryProvider analytics={coreStart.analytics}>
          <SyntheticsSharedContext {...props}>
            <Router history={appMountParameters.history}>
              <SyntheticsSettingsContextProvider {...props}>
                <PerformanceContextProvider>
                  <div className={APP_WRAPPER_CLASS} data-test-subj="syntheticsApp">
                    <InspectorContextProvider>
                      <PageRouter />
                      <ActionMenu appMountParameters={appMountParameters} />
                      <TestNowModeFlyoutContainer />
                    </InspectorContextProvider>
                  </div>
                </PerformanceContextProvider>
              </SyntheticsSettingsContextProvider>
            </Router>
          </SyntheticsSharedContext>
        </KibanaErrorBoundaryProvider>
      </KibanaThemeProvider>
    </KibanaRenderContextProvider>
  );
};

export const SyntheticsApp = (props: SyntheticsAppProps) => <Application {...props} />;
